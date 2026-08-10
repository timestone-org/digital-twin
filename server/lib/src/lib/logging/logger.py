"""日志器装配与调用面：`event` 是稳定字面量，可变部分一律进字段。"""

import json
import logging
import sys
import traceback
from dataclasses import dataclass
from typing import Any, Literal, cast

from lib.logging.context import current_log_context
from lib.utils.timeutils import format_rfc3339, utcnow

LogFormat = Literal["json", "text"]

_RESERVED = frozenset(
    {"ts", "level", "service", "role", "instance", "event", "msg"}
)


@dataclass(frozen=True)
class _Origin:
    service: str
    role: str
    instance: str


_origin = _Origin(service="service", role="api", instance="local")


def _payload_of(record: logging.LogRecord) -> dict[str, Any] | None:
    """取出 `_emit` 挂在记录上的结构化字段；不是本日志器产出的返回 None。

    Args: record。
    """
    raw = getattr(record, "payload", None)
    if not isinstance(raw, dict):
        return None
    return cast(dict[str, Any], raw)


class _JsonFormatter(logging.Formatter):
    """一条日志一行 JSON，堆栈作为字符串字段而非多行。"""

    def format(self, record: logging.LogRecord) -> str:
        payload = _payload_of(record)
        if payload is None:
            payload = {"event": "log", "msg": record.getMessage()}
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


class _TextFormatter(logging.Formatter):
    """开发环境可读形态。字段集与 JSON 完全一致，只是排版不同。"""

    def format(self, record: logging.LogRecord) -> str:
        payload = _payload_of(record)
        if payload is None:
            return record.getMessage()
        head = (
            f"{payload.get('ts')} {payload.get('level'):<5} "
            f"{payload.get('event')}"
        )
        rest = {
            key: value
            for key, value in payload.items()
            if key not in _RESERVED and value is not None
        }
        tail = " ".join(f"{key}={value!r}" for key, value in rest.items())
        message = payload.get("msg") or ""
        return f"{head} {message} {tail}".rstrip()


def configure_logging(
    *,
    service: str,
    role: str,
    instance: str,
    level: str = "INFO",
    log_format: LogFormat = "json",
) -> None:
    """装配根日志器。进程入口调用一次。

    Args: service, role, instance, level, log_format。
    """
    global _origin  # noqa: PLW0603
    _origin = _Origin(service=service, role=role, instance=instance)

    handler = logging.StreamHandler(stream=sys.stdout)
    handler.setFormatter(
        _JsonFormatter() if log_format == "json" else _TextFormatter()
    )
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level.upper())


def _error_fields(error: BaseException) -> dict[str, str]:
    return {
        "type": type(error).__name__,
        "message": str(error),
        "stack": "".join(
            traceback.format_exception(type(error), error, error.__traceback__)
        ),
    }


class ContextLogger:
    """按 observability.md §2.2 的字段集输出。`event` 必须是字面量。"""

    def __init__(self, name: str) -> None:
        self._logger = logging.getLogger(name)

    def debug(self, event: str, msg: str = "", **fields: Any) -> None:
        self._emit(logging.DEBUG, event, msg, fields)

    def info(self, event: str, msg: str = "", **fields: Any) -> None:
        self._emit(logging.INFO, event, msg, fields)

    def warning(self, event: str, msg: str = "", **fields: Any) -> None:
        self._emit(logging.WARNING, event, msg, fields)

    def error(self, event: str, msg: str = "", **fields: Any) -> None:
        self._emit(logging.ERROR, event, msg, fields)

    def _emit(
        self,
        level: int,
        event: str,
        msg: str,
        fields: dict[str, Any],
    ) -> None:
        if not self._logger.isEnabledFor(level):
            return
        context = current_log_context()
        payload: dict[str, Any] = {
            "ts": format_rfc3339(utcnow()),
            "level": logging.getLevelName(level),
            "service": _origin.service,
            "role": _origin.role,
            "instance": _origin.instance,
            "logger": self._logger.name,
            "trace_id": context.trace_id,
            "span_id": context.span_id,
            "event": event,
        }
        if context.user_id is not None:
            payload["user_id"] = context.user_id
        if context.route is not None:
            payload["route"] = context.route
        if msg:
            payload["msg"] = msg
        error = fields.pop("error", None)
        if isinstance(error, BaseException):
            payload["error"] = _error_fields(error)
        elif error is not None:
            payload["error"] = error
        payload.update(fields)
        self._logger.log(level, event, extra={"payload": payload})


def get_logger(name: str) -> ContextLogger:
    """取一个带上下文的日志器。

    Args: name。
    """
    return ContextLogger(name)
