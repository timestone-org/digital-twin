"""Redis 客户端、JSON 缓存与发布订阅。

不可达时抛 DependencyUnavailable，由调用方决定降级方向。
"""

from lib.cache.client import Cache
from lib.cache.protocol import CacheLike
from lib.cache.pubsub import PubSub

__all__ = ["Cache", "CacheLike", "PubSub"]
