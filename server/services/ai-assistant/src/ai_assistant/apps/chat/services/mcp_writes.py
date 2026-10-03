"""MCP 写操作逐次确认：短事务领取、事务外派发、持久化真实回执。

确认依赖当前属主和强制续签后的业务权限；不重试已经领取的调用。
"""

import asyncio
import secrets
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any, cast

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from ai_assistant.apps.chat.catalog import ASSISTANT_USE
from ai_assistant.apps.chat.crud import mcp_writes as crud
from ai_assistant.apps.chat.crud import session_crud
from ai_assistant.apps.chat.errors import McpWriteDeadlineExpired
from ai_assistant.apps.chat.models import ChatStep
from ai_assistant.apps.chat.schemas.mcp_writes import (
    McpWriteDecisionIn,
    McpWritePrepareOut,
)
from ai_assistant.apps.chat.services import client_receipts
from ai_assistant.apps.chat.services.advance_persist import Sessions
from ai_assistant.apps.chat.services.client_result import ClientToolResult
from ai_assistant.apps.chat.services.mcp_write_grants import (
    PendingWrite,
    binding,
    canonical,
    check_ticket,
    digest,
    snapshot,
    target_of,
)
from ai_assistant.apps.chat.services.tools.mcp_policy import (
    McpWritePolicy,
    authorize,
    policy_of,
)
from ai_assistant.settings import Settings
from ai_assistant.upstream.auth import AuthClient
from ai_assistant.upstream.mcp import McpCatalog, McpToolInfo
from ai_assistant.upstream.platform import PlatformClient
from lib.auth import CallerContext
from lib.auth.edge_headers import decode_caller
from lib.errors import Conflict, PermissionDenied, Unauthenticated
from lib.utils.timeutils import utcnow

TICKET_TTL_S = 120
MCP_NAME_SEGMENTS = 3
# 验证与派发共享预算，为边缘/客户端超时前保存实际回执留出余量。
MCP_WRITE_DEADLINE_S = 20.0


@dataclass(frozen=True)
class McpWriteDeps:
    """外部依赖集中注入；测试仅替换进程外边界。"""

    sessions: Sessions
    settings: Settings
    auth: AuthClient
    catalog: McpCatalog
    platform: PlatformClient


@dataclass(frozen=True)
class VerifiedWrite:
    """已用当前权限、目标与目录验证的执行依据。"""

    policy: McpWritePolicy
    tool: McpToolInfo
    fingerprint: str


def _grant(step_input: dict[str, Any]) -> dict[str, Any]:
    value: object = step_input.get("_mcp_write_grant")
    return cast("dict[str, Any]", value) if isinstance(value, dict) else {}


def _call_binding(pending: PendingWrite) -> str:
    return digest(
        canonical(
            {
                "owner": str(pending.owner_id),
                "session": str(pending.session_id),
                "step": str(pending.step_id),
                "call": pending.call.model_dump(),
            }
        )
    )


async def invalidate_pending(
    session: AsyncSession, session_id: uuid.UUID
) -> None:
    """新用户回合取消尚未领取的 MCP；已执行的状态保留。

    Args: session, session_id。"""
    await session_crud.lock_session(session, session_id)
    for step, _seq in await crud.steps_of(session, session_id):
        if step.name.startswith("mcp.") and step.state == "awaiting_client":
            step.state, step.ended_at = "aborted", utcnow()
            step.input_json = {
                **(step.input_json or {}),
                "_mcp_write_grant": {},
            }
    await session.flush()


class McpWriteService:
    """没有进程内票据状态；所有竞争者在数据库中原子领取。"""

    def __init__(
        self,
        deps: McpWriteDeps,
        *,
        clock: Callable[[], datetime] = utcnow,
        ticket_source: Callable[[], str] = lambda: secrets.token_urlsafe(32),
        deadline_s: float = MCP_WRITE_DEADLINE_S,
    ) -> None:
        """注入事务、外部服务及时钟。

        Args: deps, clock, ticket_source, deadline_s。"""
        if not 0 < deadline_s <= MCP_WRITE_DEADLINE_S:
            raise ValueError("MCP 写等待预算必须大于零且不超过 20 秒")
        self._deps, self._clock, self._tickets = deps, clock, ticket_source
        self._deadline_s = deadline_s

    def _deadline_at_s(self) -> float:
        return asyncio.get_running_loop().time() + self._deadline_s

    async def _verify_before(
        self, pending: PendingWrite, deadline_at_s: float
    ) -> VerifiedWrite:
        if asyncio.get_running_loop().time() >= deadline_at_s:
            raise McpWriteDeadlineExpired("MCP 写验证超时，未派发操作")
        try:
            async with asyncio.timeout_at(deadline_at_s):
                return await self._verify(pending)
        except TimeoutError as error:
            raise McpWriteDeadlineExpired(
                "MCP 写验证超时，未派发操作；请重新发起调用"
            ) from error

    async def _capture(
        self, session_id: uuid.UUID, call_id: str, caller: CallerContext
    ) -> PendingWrite:
        async with self._deps.sessions() as session:
            owner = await crud.lock_owner(session, session_id, caller.user_id)
            if owner.is_archived:
                raise Conflict("会话已归档，不能执行写操作")
            step = await crud.active_call(session, session_id, call_id)
            if (step.input_json or {}).get("_mcp_confirmation_protocol") != 1:
                raise Conflict("旧版 MCP 调用不可执行，请重新发起回合")
            return snapshot(step, session_id, caller.user_id)

    async def _verify(self, pending: PendingWrite) -> VerifiedWrite:
        policy = policy_of(self._deps.settings, pending.call.name)
        if policy is None:
            raise PermissionDenied("该 MCP 写操作没有明确授权政策")
        pieces = pending.call.name.split(".")
        if len(pieces) != MCP_NAME_SEGMENTS:
            raise Conflict("MCP 工具名无效")
        headers = await self._fresh_headers(pending, policy)
        await self._deps.catalog.refresh_server(pieces[1])
        tool = (
            self._deps.catalog.find(pieces[1], pieces[2])
            if len(pieces) == MCP_NAME_SEGMENTS
            else None
        )
        if tool is None:
            raise Conflict("该 MCP 工具已不可用")
        await self._deps.platform.read_mcp_target(
            headers, policy.resource_kind, str(target_of(pending, policy))
        )
        # 目录/资源查询期间可能撤权；最后一次续签紧挨短事务领取。
        await self._fresh_headers(pending, policy)
        return VerifiedWrite(policy, tool, binding(pending, policy, tool))

    async def _fresh_headers(
        self, pending: PendingWrite, policy: McpWritePolicy
    ) -> dict[str, str]:
        headers = await self._deps.auth.reissue_headers(str(pending.owner_id))
        decoded = decode_caller(
            httpx.Headers(headers),
            signing_secret=self._deps.settings.edge_signing_secret.get_secret_value(),
            now=self._clock(),
        )
        fresh = decoded.caller
        if (
            fresh is None
            or fresh.user_id != pending.owner_id
            or fresh.is_service
        ):
            raise Unauthenticated("执行身份续签无效")
        if not fresh.has_all(frozenset({ASSISTANT_USE})) or not authorize(
            policy, fresh.permissions
        ):
            raise PermissionDenied("当前身份没有该写操作的业务权限")
        return headers

    async def prepare(
        self, session_id: uuid.UUID, call_id: str, caller: CallerContext
    ) -> McpWritePrepareOut:
        """展示已存调用并签发单次票据。

        Args: session_id, call_id, caller。"""
        deadline_at_s = self._deadline_at_s()
        pending = await self._capture(session_id, call_id, caller)
        verified = await self._verify_before(pending, deadline_at_s)
        ticket = self._tickets()
        expires = self._clock() + timedelta(seconds=TICKET_TTL_S)
        async with self._deps.sessions() as session:
            await crud.lock_owner(session, session_id, caller.user_id)
            step = await crud.active_call(session, session_id, call_id)
            self._unchanged(step, pending)
            step.input_json = {
                **(step.input_json or {}),
                "_mcp_write_grant": {
                    "sha256": digest(ticket),
                    "binding": verified.fingerprint,
                    "call_binding": _call_binding(pending),
                    "state": "issued",
                    "expires_at": expires.isoformat(),
                },
            }
        return McpWritePrepareOut(
            call_id=call_id,
            tool_name=pending.call.name,
            arguments=pending.call.arguments,
            target=(
                f"{verified.policy.resource_kind}:"
                f"{target_of(pending, verified.policy)}"
            ),
            impact=verified.policy.impact,
            ticket=ticket,
            expires_at=expires,
        )

    def _unchanged(self, step: ChatStep, pending: PendingWrite) -> None:
        # 这里只接受 ORM 步骤；用 snapshot 锁定入参不受 JSONB 原地修改影响。
        if snapshot(step, pending.session_id, pending.owner_id) != pending:
            raise Conflict("待执行调用已改变，请重新查看操作")

    async def _ticket_valid(
        self, pending: PendingWrite, ticket: str, expected: str | None = None
    ) -> None:
        async with self._deps.sessions() as session:
            await crud.lock_owner(session, pending.session_id, pending.owner_id)
            step = await crud.active_call(
                session, pending.session_id, pending.call.call_id
            )
            self._unchanged(step, pending)
            grant = _grant(step.input_json or {})
            if grant.get("call_binding") != _call_binding(pending):
                raise Conflict("确认调用已改变")
            bound = grant.get("binding")
            check_ticket(grant, ticket, expected or str(bound), self._clock())

    async def decide(
        self,
        session_id: uuid.UUID,
        call_id: str,
        caller: CallerContext,
        decision: McpWriteDecisionIn,
    ) -> ClientToolResult:
        """确认后只派发一次，取消不调用认证或外部工具。

        Args: session_id, call_id, caller, decision。"""
        deadline_at_s = self._deadline_at_s()
        pending = await self._capture(session_id, call_id, caller)
        await self._ticket_valid(pending, decision.ticket)
        if not decision.confirm:
            return await self._cancel(pending, decision.ticket)
        try:
            verified = await self._verify_before(pending, deadline_at_s)
        except Exception:
            await self._reject_verification(pending, decision.ticket)
            raise
        await self._claim(pending, decision.ticket, verified)
        execution = asyncio.create_task(
            self._dispatch_and_record(pending, verified, deadline_at_s)
        )
        try:
            return await asyncio.shield(execution)
        except asyncio.CancelledError:
            await self._drain(execution)
            raise

    async def _reject_verification(
        self, pending: PendingWrite, ticket: str
    ) -> None:
        async with self._deps.sessions() as session:
            await crud.lock_owner(session, pending.session_id, pending.owner_id)
            try:
                step = await crud.active_call(
                    session, pending.session_id, pending.call.call_id
                )
                self._unchanged(step, pending)
                grant = _grant(step.input_json or {})
                check_ticket(
                    grant, ticket, str(grant.get("binding")), self._clock()
                )
            except Conflict:
                return
            result = ClientToolResult(
                pending.call.call_id,
                output={
                    "is_dispatched": False,
                    "reason": "verification_failed",
                },
                error="执行验证失败，未派发 MCP 写操作；请重新发起调用",
            )
            await self._record(session, pending, result)

    async def _drain(self, execution: asyncio.Task[ClientToolResult]) -> None:
        while not execution.done():
            try:
                await asyncio.shield(execution)
            except asyncio.CancelledError:
                continue
        execution.result()

    async def _dispatch_and_record(
        self,
        pending: PendingWrite,
        verified: VerifiedWrite,
        deadline_at_s: float,
    ) -> ClientToolResult:
        result = await self._execute(pending, verified, deadline_at_s)
        await self._finish(pending, result)
        return result

    async def _claim(
        self, pending: PendingWrite, ticket: str, verified: VerifiedWrite
    ) -> None:
        async with self._deps.sessions() as session:
            owner = await crud.lock_owner(
                session, pending.session_id, pending.owner_id
            )
            if owner.is_archived:
                raise Conflict("会话已归档")
            step = await crud.active_call(
                session, pending.session_id, pending.call.call_id
            )
            self._unchanged(step, pending)
            grant = _grant(step.input_json or {})
            check_ticket(grant, ticket, verified.fingerprint, self._clock())
            step.state, step.started_at = "running", self._clock()
            step.input_json = {
                **(step.input_json or {}),
                "_mcp_write_grant": {**grant, "state": "claimed"},
            }

    async def _cancel(
        self, pending: PendingWrite, ticket: str
    ) -> ClientToolResult:
        result = ClientToolResult(
            pending.call.call_id, output={"is_cancelled": True}
        )
        async with self._deps.sessions() as session:
            await crud.lock_owner(session, pending.session_id, pending.owner_id)
            step = await crud.active_call(
                session, pending.session_id, pending.call.call_id
            )
            self._unchanged(step, pending)
            grant = _grant(step.input_json or {})
            check_ticket(
                grant, ticket, str(grant.get("binding")), self._clock()
            )
            await self._record(session, pending, result)
            step.state = "aborted"
        return result

    async def _execute(
        self,
        pending: PendingWrite,
        verified: VerifiedWrite,
        deadline_at_s: float,
    ) -> ClientToolResult:
        if asyncio.get_running_loop().time() >= deadline_at_s:
            return ClientToolResult(
                pending.call.call_id,
                output={"is_dispatched": False, "reason": "deadline_expired"},
                error="MCP 写等待超时，未派发操作；请重新发起调用",
            )
        try:
            async with asyncio.timeout_at(deadline_at_s):
                output = await self._deps.catalog.call(
                    verified.tool.server,
                    verified.tool.tool,
                    pending.call.arguments,
                )
        except Exception:
            return ClientToolResult(
                pending.call.call_id,
                error="MCP 执行失败或结果未知；请核对实际状态，不要重复执行",
            )
        body: object = output
        error = (
            "MCP 工具报告执行失败"
            if isinstance(body, dict)
            and cast("dict[str, object]", body).get("isError") is True
            else None
        )
        return ClientToolResult(
            pending.call.call_id, output=output, error=error
        )

    async def _finish(
        self, pending: PendingWrite, result: ClientToolResult
    ) -> None:
        async with self._deps.sessions() as session:
            await crud.lock_owner(session, pending.session_id, pending.owner_id)
            await self._record(session, pending, result)

    async def _record(
        self,
        session: AsyncSession,
        pending: PendingWrite,
        result: ClientToolResult,
    ) -> None:
        step = await crud.step_by_id(session, pending.step_id)
        client_receipts.settle([(step, result)])
        step.ended_at = self._clock()
        grant = _grant(step.input_json or {})
        step.input_json = {
            **(step.input_json or {}),
            "_mcp_write_grant": {**grant, "state": "consumed"},
        }
        await crud.append_receipt(
            session,
            pending.session_id,
            {
                "tool_call_id": result.call_id,
                "text": result.as_text(),
            },
        )
        await session.flush()
