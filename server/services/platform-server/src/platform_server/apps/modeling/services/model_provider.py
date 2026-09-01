"""台账那个抽象的建模实现：按公式标识把模型版本编译成可调用对象。

⚠ 依赖方向：本模块编译期认识 `apps/dataset`，反过来永远不认识。装配点在
`app.py` 与 `worker.py` **两处**——注册表是进程内的，而重算可能落到任意 API
副本、也可能跑在 worker 上（docs/MODELING_DESIGN.md §3.2）。
⚠ 每批只查一次库：单行写触发的重算批量恒为 1，每批的固定开销必须小。
"""

from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.dataset.services import (
    AnalysisModel,
    AnalysisProvider,
    AnalysisUnavailable,
    LoadedModels,
    Sessions,
)
from platform_server.apps.modeling.crud import binding_crud, model_version_crud
from platform_server.apps.modeling.models import ModelingBinding
from platform_server.apps.modeling.operators import OperatorError
from platform_server.apps.modeling.services.serving import compile_model

PROVIDER_CODE = "modeling"


@dataclass(frozen=True)
class ModelingAnalysisProvider(AnalysisProvider):
    """把公式库条目标识翻成一个能算数的模型。"""

    @property
    def code(self) -> str:
        """提供者标识。"""
        return PROVIDER_CODE

    async def load(
        self, sessions: Sessions, codes: frozenset[str]
    ) -> LoadedModels:
        """一次装一批。查一次绑定、查一次版本，其余全是纯计算。

        Args: sessions, codes。
        """
        loaded: dict[str, AnalysisModel | AnalysisUnavailable] = {}
        async with sessions.session() as session:
            bindings = await binding_crud.list_by_codes(
                session, tuple(sorted(codes))
            )
            found = {binding.fx_code: binding for binding in bindings}
            for code in codes:
                loaded[code] = await self._one(session, found.get(code))
        return loaded

    async def _one(
        self, session: AsyncSession, binding: ModelingBinding | None
    ) -> AnalysisModel | AnalysisUnavailable:
        """一条绑定编译出来的模型，或一句用不了的原因。

        Args: session, binding。
        """
        if binding is None:
            return AnalysisUnavailable(reason="模型未绑定")
        if not binding.is_enabled:
            return AnalysisUnavailable(reason="模型绑定已停用")
        version = await model_version_crud.get(
            session, binding.model_version_id
        )
        if version is None:
            return AnalysisUnavailable(reason="绑定指向的模型版本已不存在")
        if not version.servable:
            return AnalysisUnavailable(
                reason=version.unservable_reason or "这个模型版本不可上线"
            )
        try:
            return compile_model(dict(version.serving_json))
        except OperatorError as error:
            return AnalysisUnavailable(reason=str(error))
