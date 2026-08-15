"""共享测试假件。测试设施而非被测代码，已排除出覆盖率统计。

⚠ 生产代码引用本包由结构检查拦截。
"""

from lib.testing.clock import FrozenClock
from lib.testing.fake_cache import InMemoryCache, UnavailableCache
from lib.testing.fake_objectstore import FakeObjectStore

__all__ = [
    "FakeObjectStore",
    "FrozenClock",
    "InMemoryCache",
    "UnavailableCache",
]
