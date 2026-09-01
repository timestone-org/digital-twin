"""打上游服务的瘦客户端。"""

from ai_assistant.upstream.auth import AuthClient, AuthUnavailable
from ai_assistant.upstream.identity import (
    DelegatedIdentity,
    caller_headers,
)
from ai_assistant.upstream.mcp import (
    McpCatalog,
    McpClient,
    McpServer,
    McpToolInfo,
    McpUnavailable,
)
from ai_assistant.upstream.platform import PlatformClient, PlatformUnavailable

__all__ = [
    "AuthClient",
    "AuthUnavailable",
    "DelegatedIdentity",
    "McpCatalog",
    "McpClient",
    "McpServer",
    "McpToolInfo",
    "McpUnavailable",
    "PlatformClient",
    "PlatformUnavailable",
    "caller_headers",
]
