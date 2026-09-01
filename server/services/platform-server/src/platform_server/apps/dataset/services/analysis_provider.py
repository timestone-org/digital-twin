"""分析模型的提供者：台账只认这个抽象，永远不认识建模模块。

⚠ 依赖方向靠这里反转：`apps/modeling` 编译期认识 `apps/dataset`，反过来永远
不认识。运行期台账求值确实会调到建模的代码，但那是经这张注册表做到的
（docs/MODELING_DESIGN.md D2、§7.2）。
⚠ 注册表是**进程内**全局：单行写触发的重算会落到任意 API 副本，回填跑在
worker 上——**每个角色都要注册**，漏一处的现象是「有时候出数、有时候是空」，
且与副本编号相关，极难复现。
"""

from abc import ABC, abstractmethod
from collections.abc import Mapping

from lib.logging import get_logger
from platform_server.apps.dataset.formula import (
    AnalysisModel,
    AnalysisUnavailable,
)

__all__ = [
    "AnalysisModel",
    "AnalysisProvider",
    "AnalysisUnavailable",
    "LoadedModels",
    "load_models",
    "register_provider",
    "registered_providers",
]
from platform_server.apps.dataset.services.sessions import Sessions

_logger = get_logger("platform.dataset.analysis")

type LoadedModels = Mapping[str, AnalysisModel | AnalysisUnavailable]


class AnalysisProvider(ABC):
    """按标识把一批模型编译成可调用对象。"""

    @property
    @abstractmethod
    def code(self) -> str:
        """提供者标识，注册表的键。"""

    @abstractmethod
    async def load(
        self, sessions: Sessions, codes: frozenset[str]
    ) -> LoadedModels:
        """一次装一批。

        ⚠ 允许查库，但**回来的对象在求值期不许再有任何 I/O**：求值器是纯同步
        的，一次重算横跨上万行。
        Args: sessions, codes。
        """


_PROVIDERS: dict[str, AnalysisProvider] = {}


def register_provider(provider: AnalysisProvider) -> None:
    """登记一个提供者。重名覆盖，故注册天然幂等。

    Args: provider。
    """
    _PROVIDERS[provider.code] = provider


def registered_providers() -> tuple[str, ...]:
    """已登记的提供者标识，按字典序。"""
    return tuple(sorted(_PROVIDERS))


async def load_models(
    sessions: Sessions, codes: frozenset[str]
) -> dict[str, AnalysisModel | AnalysisUnavailable]:
    """把这一批标识交给每个提供者去装，合并结果。

    ⚠ 一个提供者抛错不许把整次重算带走：那一批标识落成「用不了 + 原因」，
    其余提供者照常装。整批 500 的话，用户看到的是一整张表都算不出来，
    而真相可能只是一个模型的版本行坏了。
    Args: sessions, codes。
    """
    loaded: dict[str, AnalysisModel | AnalysisUnavailable] = {}
    if not codes:
        return loaded
    for provider in _PROVIDERS.values():
        loaded.update(await _load_one(provider, sessions, codes))
    return loaded


async def _load_one(
    provider: AnalysisProvider, sessions: Sessions, codes: frozenset[str]
) -> LoadedModels:
    try:
        return await provider.load(sessions, codes)
    except Exception as error:
        _logger.error(
            "analysis_provider_failed",
            "分析模型装不出来",
            provider=provider.code,
            error=error,
        )
        unavailable = AnalysisUnavailable(reason="模型暂时不可用")
        return dict.fromkeys(codes, unavailable)
