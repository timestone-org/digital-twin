"""Redis 客户端与 JSON 缓存。

不可达时抛 DependencyUnavailable，由调用方决定降级方向。
"""

from lib.cache.client import Cache
from lib.cache.protocol import CacheLike

__all__ = ["Cache", "CacheLike"]
