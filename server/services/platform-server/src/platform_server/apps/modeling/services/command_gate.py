"""先短事务预留命令，再将业务写入和成功回执一起提交。"""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime

from pydantic import BaseModel, JsonValue, TypeAdapter
from sqlalchemy.ext.asyncio import AsyncSession
from uuid_utils.compat import uuid7

from lib.errors import AppError, DependencyUnavailable, FieldError
from lib.logging.context import current_log_context
from lib.web.response import FieldErrorOut
from platform_server.apps.modeling.command_errors import (
    CommandPayloadConflict,
    CommandPending,
    LegacyCommandConflict,
)
from platform_server.apps.modeling.crud import command
from platform_server.apps.modeling.models.command import ModelingCommand
from platform_server.apps.modeling.schemas.command import CommandFailureOut
from platform_server.apps.modeling.services.command_policy import (
    hash_key,
    parse_scope,
)
from platform_server.apps.modeling.services.operator_audit import (
    AuditEvent,
    OperatorIdentity,
    record_operator,
)
from platform_server.apps.modeling.services.sessions import Sessions
from platform_server.deps import WriteGate

_JSON_OBJECT = TypeAdapter(dict[str, JsonValue])
SERVER_ERROR_STATUS = 500


@dataclass(frozen=True)
class DurableModelingGate(WriteGate):
    session: AsyncSession
    sessions: Sessions
    request_hash: str
    on_command: Callable[[str], None]
    clock: Callable[[], datetime]
    operator: OperatorIdentity

    async def run_once[ResultT: BaseModel](
        self,
        *,
        endpoint: str,
        model: type[ResultT],
        action: Callable[[], Awaitable[ResultT]],
    ) -> ResultT:
        """执行或恢复同一命令；Args: endpoint, model, action。"""
        operation = parse_scope(endpoint)
        if self.idempotency_key is None:
            result = await action()
            self._audit(endpoint, result, None)
            return result
        row, is_owner = await self._reserve(endpoint, model)
        self.on_command(str(row.id))
        if not is_owner:
            return _replay(row, self.request_hash, model)
        try:
            async with self.session.begin_nested():
                result = await action()
                self._audit(endpoint, result, row.id)
                await command.complete(
                    self.session,
                    command.CommandCompletion(
                        row.id,
                        operation.http_status,
                        _JSON_OBJECT.validate_python(
                            result.model_dump(mode="json", by_alias=True)
                        ),
                        self.clock(),
                    ),
                )
        except AppError as error:
            if error.http_status < SERVER_ERROR_STATUS:
                await self._record_rejection(row, error)
            raise
        return result

    def _audit(
        self, endpoint: str, result: BaseModel, command_id: uuid.UUID | None
    ) -> None:
        operation = parse_scope(endpoint)
        result_id: object = getattr(result, "id", None)
        resource_id = (
            result_id
            if isinstance(result_id, uuid.UUID)
            else operation.resource_id
        )
        record_operator(
            self.session,
            self.operator,
            AuditEvent(
                operation.name, resource_id, command_id, operation.http_status
            ),
        )

    async def _reserve[ResultT: BaseModel](
        self, endpoint: str, model: type[ResultT]
    ) -> tuple[ModelingCommand, bool]:
        candidate = ModelingCommand(
            id=uuid7(),
            account_user_id=self.caller.user_id,
            scope=endpoint,
            key_hash=hash_key(self.idempotency_key or ""),
            request_hash=self.request_hash,
            state="pending",
            trace_id=current_log_context().trace_id or "",
        )
        async with self.sessions.session() as opened:
            existing = await command.find(
                opened,
                command.CommandIdentity(
                    candidate.account_user_id, endpoint, candidate.key_hash
                ),
            )
        if existing is not None:
            return existing, False
        await self._check_legacy(endpoint, model)
        async with self.sessions.session() as opened:
            return await command.reserve(opened, candidate)

    async def _check_legacy[ResultT: BaseModel](
        self, endpoint: str, model: type[ResultT]
    ) -> None:
        try:
            legacy = await self.idempotency.lookup_result(
                endpoint=endpoint,
                key=self.idempotency_key or "",
                caller=self.caller.user_id,
                model=model,
            )
        except Exception as error:
            raise DependencyUnavailable(
                "暂时无法核查旧版命令结果，请稍后查询，勿重复操作"
            ) from error
        if legacy is not None:
            raise LegacyCommandConflict(
                "此幂等键已有旧版成功结果，请按已有资源核查；不会重新执行"
            )

    async def _record_rejection(
        self, row: ModelingCommand, error: AppError
    ) -> None:
        # ⚠ 仅在业务保存点已回滚后记失败；提交结果未知时保留 pending。
        payload = CommandFailureOut(
            code=error.code,
            message=error.message,
            details=[
                FieldErrorOut(
                    field=item.field, code=item.code, message=item.message
                )
                for item in error.details
            ],
        )
        async with self.sessions.session() as opened:
            await command.complete(
                opened,
                command.CommandCompletion(
                    row.id,
                    error.http_status,
                    _JSON_OBJECT.validate_python(
                        payload.model_dump(mode="json")
                    ),
                    self.clock(),
                    is_failure=True,
                ),
            )
            operation = parse_scope(row.scope)
            record_operator(
                opened,
                self.operator,
                AuditEvent(
                    operation.name,
                    operation.resource_id,
                    row.id,
                    error.http_status,
                ),
            )


def _replay[ResultT: BaseModel](
    row: ModelingCommand, request_hash: str, model: type[ResultT]
) -> ResultT:
    if row.request_hash != request_hash:
        raise CommandPayloadConflict(
            "此幂等键已用于另一组请求参数，请核查原命令"
        )
    if row.state == "succeeded":
        return model.model_validate(row.result_json)
    if row.state == "failed":
        failure = CommandFailureOut.model_validate(row.error_json)
        error = AppError(
            failure.message,
            details=tuple(
                FieldError(item.field, item.code, item.message)
                for item in failure.details
            ),
        )
        error.code = failure.code
        error.http_status = row.http_status or 400
        raise error
    raise CommandPending(str(row.id))
