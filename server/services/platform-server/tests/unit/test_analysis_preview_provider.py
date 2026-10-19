"""公式预览必须显式选择轻量提供者能力，不回退到常规模型加载。"""

from contextlib import AbstractAsyncContextManager

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.dataset.services import analysis_provider
from platform_server.apps.dataset.services.analysis_provider import (
    AnalysisProvider,
    AnalysisUnavailable,
    LoadedModels,
)
from platform_server.apps.dataset.services.sessions import Sessions


class UnusedSessions:
    """这组提供者不需要数据库。"""

    def session(self) -> AbstractAsyncContextManager[AsyncSession]:
        raise AssertionError("不应访问数据库")


class RegularProvider(AnalysisProvider):
    """只声明常规加载能力的提供者。"""

    @property
    def code(self) -> str:
        return "regular"

    async def load(
        self, sessions: Sessions, codes: frozenset[str]
    ) -> LoadedModels:
        del sessions
        return dict.fromkeys(
            codes, AnalysisUnavailable(reason="常规加载的结果")
        )


class FailingPreviewProvider(RegularProvider):
    """预览提供者的基础设施失败。"""

    async def load_preview(
        self, sessions: Sessions, codes: frozenset[str]
    ) -> LoadedModels:
        del sessions, codes
        raise RuntimeError("内部基础设施详情")


@pytest.fixture(autouse=True)
def isolated_providers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(analysis_provider, "_PROVIDERS", {})


async def test_provider_without_preview_support_returns_unavailable() -> None:
    analysis_provider.register_provider(RegularProvider())
    codes = frozenset({"model"})
    preview = await analysis_provider.load_preview_models(
        UnusedSessions(), codes
    )
    regular = await analysis_provider.load_models(UnusedSessions(), codes)
    assert preview == {
        "model": AnalysisUnavailable(reason="这个模型暂不支持公式预览")
    }
    assert regular == {"model": AnalysisUnavailable(reason="常规加载的结果")}


async def test_preview_failure_has_a_public_unavailable_reason() -> None:
    analysis_provider.register_provider(FailingPreviewProvider())
    loaded = await analysis_provider.load_preview_models(
        UnusedSessions(), frozenset({"model"})
    )
    assert loaded == {"model": AnalysisUnavailable(reason="模型暂时不可用")}


async def test_preview_without_model_references_does_not_load_a_provider() -> (
    None
):
    analysis_provider.register_provider(FailingPreviewProvider())
    assert (
        await analysis_provider.load_preview_models(
            UnusedSessions(), frozenset()
        )
        == {}
    )
