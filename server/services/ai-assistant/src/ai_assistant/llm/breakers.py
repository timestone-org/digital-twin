"""断路器按需生长的那一本册子：一格 (档位, 用途) 一个。

⚠ 档位来自**运行期可改的目录**（ADR-0040），启动时一次建完的话，之后在界面上
新配的那一路就没有自己的断路器——它会落到兜底那一个上，于是一路挂掉会把别的
路一起短路，而那几路本来好好的。

⚠ 一格一个，不是一路一个：看图那一档可以落在另一家端点上，它连挂几次不该把
同一路的对话一起短路掉。

⚠ 只增不删：档位删掉之后那一格还留着，占的是一个对象的空间；按目录去清理的话，
一次目录抖动就会把正在半开的那几格重置成全新的。
"""

from collections.abc import Callable, Iterator, Mapping

from lib.resilience import CircuitBreaker

# 册子的键：(档位名, 用途档)
BreakerKey = tuple[str, str]


class BreakerBook(Mapping[BreakerKey, CircuitBreaker]):
    """按 (档位, 用途) 取断路器，没有就现造一个。"""

    def __init__(self, make: Callable[[str, str], CircuitBreaker]) -> None:
        """Args: make（按档位与用途造一个）。"""
        self._make = make
        self._found: dict[BreakerKey, CircuitBreaker] = {}

    def __getitem__(self, key: BreakerKey) -> CircuitBreaker:
        """取那一格；第一次问的时候现造。

        ⚠ `Mapping.get(key, default)` 走的也是这里：调用方拿 `.get` 取不到时
        用的是兜底那一个，而这里让它永远取得到自己那一格。

        Args: key。
        """
        found = self._found.get(key)
        if found is None:
            found = self._make(*key)
            self._found[key] = found
        return found

    def __iter__(self) -> Iterator[BreakerKey]:
        return iter(self._found)

    def __len__(self) -> int:
        return len(self._found)
