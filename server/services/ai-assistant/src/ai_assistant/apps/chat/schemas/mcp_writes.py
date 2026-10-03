"""MCP 写确认只引用已持久化的调用，不接收工具名或入参。"""

from typing import Any

from pydantic import Field, StrictBool

from ai_assistant.apps.chat.schemas.common import InputModel, OutputModel, Utc


class McpWritePrepareOut(OutputModel):
    """服务端准备的真实操作摘要及短期、单次确认票据。"""

    call_id: str
    tool_name: str
    arguments: dict[str, Any]
    target: str
    impact: str
    ticket: str
    expires_at: Utc


class McpWriteDecisionIn(InputModel):
    """确认或取消同一张票据；不允许客户端改变调用。"""

    ticket: str = Field(min_length=32, max_length=256)
    confirm: StrictBool


class McpWriteResultOut(OutputModel):
    """实际派发结果或取消回执，供模型续跑使用。"""

    call_id: str
    output: Any = None
    error: str | None = None


class McpWritePrepareIn(InputModel):
    """允许空请求体；任何工具名或入参字段都会被拒绝。"""
