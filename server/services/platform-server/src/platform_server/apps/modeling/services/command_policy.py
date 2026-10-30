"""建模写命令的稳定操作名、作用域、权限与请求指纹。"""

import hashlib
import json
import uuid
from dataclasses import dataclass

from pydantic import TypeAdapter

from lib.errors import ValidationFailed
from platform_server.apps.modeling.catalog import MODELING_PUBLISH, MODELING_RUN
from platform_server.apps.modeling.schemas.command import CommandOperation

_OPERATIONS: TypeAdapter[CommandOperation] = TypeAdapter(CommandOperation)
MAX_IDEMPOTENCY_KEY_LENGTH = 256
_UNSCOPED = frozenset(
    {"create_instance", "publish_version", "create_deployment"}
)
_RUN_OPERATIONS = frozenset(
    {
        "create_instance",
        "configure_instance",
        "train_instance",
        "archive_instance",
        "restore_instance",
        "cancel_run",
    }
)
_CREATING = frozenset(
    {
        "create_instance",
        "publish_version",
        "deploy_instance",
        "create_deployment",
    }
)
_DELETING = frozenset({"retire_version", "delete_deployment"})


@dataclass(frozen=True)
class Operation:
    name: CommandOperation
    resource_id: uuid.UUID | None

    @property
    def scope(self) -> str:
        suffix = f".{self.resource_id}" if self.resource_id else ""
        return f"modeling.{self.name}{suffix}"

    @property
    def permission(self) -> str:
        return (
            MODELING_RUN if self.name in _RUN_OPERATIONS else MODELING_PUBLISH
        )

    @property
    def http_status(self) -> int:
        if self.name in _CREATING:
            return 201
        if self.name in _DELETING:
            return 204
        return 202 if self.name == "train_instance" else 200


def choose_operation(
    name: CommandOperation, resource_id: uuid.UUID | None
) -> Operation:
    """校验操作的资源身份；Args: name, resource_id。"""
    if (name in _UNSCOPED) != (resource_id is None):
        raise ValidationFailed("此操作的 resource_id 与操作范围不匹配")
    return Operation(name, resource_id)


def parse_scope(scope: str) -> Operation:
    """解析内部写入口的稳定作用域；Args: scope。"""
    prefix, _, remainder = scope.partition(".")
    name, _, resource = remainder.partition(".")
    if prefix != "modeling":
        raise ValidationFailed("无法识别的建模命令")
    try:
        operation = _OPERATIONS.validate_python(name)
        resource_id = uuid.UUID(resource) if resource else None
    except ValueError as error:
        raise ValidationFailed("无法识别的建模命令") from error
    return choose_operation(operation, resource_id)


def hash_key(key: str) -> str:
    if (
        not key
        or len(key) > MAX_IDEMPOTENCY_KEY_LENGTH
        or not key.isascii()
        or not key.isprintable()
    ):
        raise ValidationFailed("Idempotency-Key 须为 1–256 个可打印 ASCII 字符")
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def fingerprint(
    method: str, path: str, body: bytes, operator: str | None
) -> str:
    """固定语义相同的 JSON 请求指纹；Args: method, path, body, operator。"""
    try:
        payload: object = json.loads(body) if body else None
        canonical = json.dumps(
            [method, path, payload, operator],
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
            allow_nan=False,
        )
    except (ValueError, UnicodeError) as error:
        raise ValidationFailed("请求必须是有效 JSON") from error
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
