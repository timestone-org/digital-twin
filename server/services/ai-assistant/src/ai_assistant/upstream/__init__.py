"""打上游服务的瘦客户端。"""

from ai_assistant.upstream.identity import caller_headers
from ai_assistant.upstream.platform import PlatformClient, PlatformUnavailable

__all__ = ["PlatformClient", "PlatformUnavailable", "caller_headers"]
