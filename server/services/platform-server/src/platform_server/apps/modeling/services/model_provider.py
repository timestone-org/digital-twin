"""台账那个抽象的建模实现：按公式标识把模型版本编译成可调用对象。

⚠ 依赖方向：本模块编译期认识 `apps/dataset`，反过来永远不认识。装配点在
`app.py` 与 `worker.py` **两处**——注册表是进程内的，而重算可能落到任意 API
副本、也可能跑在 worker 上（docs/MODELING_DESIGN.md §3.2）。
⚠ 查库与下载分两段：库在一个会话里查完就关，对象存储的下载与反序列化在会话
之外做——在会话里下载会把池连接一直占到下载完（事务内禁外部 IO）。
"""

from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from lib.objectstore import ObjectStore
from platform_server.apps.dataset.services import (
    AnalysisModel,
    AnalysisProvider,
    AnalysisUnavailable,
    LoadedModels,
    Sessions,
)
from platform_server.apps.modeling.crud import (
    binding_crud,
    model_artifact_crud,
    model_version_crud,
)
from platform_server.apps.modeling.models import (
    ModelingBinding,
    ModelVersion,
)
from platform_server.apps.modeling.operators import (
    CHANNEL_BINARY,
    CHANNEL_JSON,
    OperatorError,
)
from platform_server.apps.modeling.services import artifact_io
from platform_server.apps.modeling.services.artifact_store import (
    ArtifactRejected,
)
from platform_server.apps.modeling.services.serving import compile_model

PROVIDER_CODE = "modeling"


@dataclass(frozen=True)
class _Plan:
    """会话里查好的一个版本：可服务表示，外加通道 B 要下载的产物元信息。"""

    serving: dict[str, Any]
    #: 通道 A 为 None
    artifact: dict[str, Any] | None


@dataclass(frozen=True)
class ModelingAnalysisProvider(AnalysisProvider):
    """把公式库条目标识翻成一个能算数的模型。

    ⚠ 装配点给不给 `store` 决定通道 B 的模型能不能用：给不了的时候那些绑定
    一律给一句「没配对象存储」，而不是悄悄算不出数。
    """

    store: ObjectStore | None = None
    #: 进程内的模型本体缓存。⚠ 挂在实例上而不是模块上：模块级可变状态会让
    #: 两次测试之间互相看见对方装过的模型
    cache: artifact_io.ArtifactCache = field(
        default_factory=artifact_io.ArtifactCache
    )

    @property
    def code(self) -> str:
        """提供者标识。"""
        return PROVIDER_CODE

    async def load(
        self, sessions: Sessions, codes: frozenset[str]
    ) -> LoadedModels:
        """一次装一批。先在一个会话里查完库，关掉会话再下载与编译。

        Args: sessions, codes。
        """
        return await self._load(sessions, codes, is_preview=False)

    async def load_preview(
        self, sessions: Sessions, codes: frozenset[str]
    ) -> LoadedModels:
        """只编译 JSON 模型，不读取或解码二进制产物。Args: sessions, codes。"""
        return await self._load(sessions, codes, is_preview=True)

    async def _load(
        self, sessions: Sessions, codes: frozenset[str], *, is_preview: bool
    ) -> LoadedModels:
        planned: dict[str, _Plan | AnalysisUnavailable] = {}
        async with sessions.session() as session:
            bindings = await binding_crud.list_by_codes(
                session, tuple(sorted(codes))
            )
            found = {binding.fx_code: binding for binding in bindings}
            for code in codes:
                planned[code] = await self._plan(
                    session, found.get(code), is_preview=is_preview
                )
        loaded: dict[str, AnalysisModel | AnalysisUnavailable] = {}
        for code, plan in planned.items():
            loaded[code] = (
                await self._compiled(plan) if isinstance(plan, _Plan) else plan
            )
        return loaded

    async def _plan(
        self,
        session: AsyncSession,
        binding: ModelingBinding | None,
        *,
        is_preview: bool,
    ) -> _Plan | AnalysisUnavailable:
        """一条绑定在库里查得到的全部东西，或一句用不了的原因。

        Args: session, binding, is_preview。
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
        refusal = _refusal_of(version, is_preview=is_preview)
        if refusal is not None:
            return refusal
        try:
            artifact = (
                None if is_preview else await self._artifact(session, version)
            )
        except ArtifactRejected as error:
            return AnalysisUnavailable(reason=str(error))
        return _Plan(serving=dict(version.serving_json), artifact=artifact)

    async def _compiled(
        self, plan: _Plan
    ) -> AnalysisModel | AnalysisUnavailable:
        """编译一个版本。通道 B 先把模型本体从对象存储装回来。

        ⚠ 加载放在**取数相位**：编译出来的东西在求值期只做算术，那里一次 I/O
        都不许有（docs/MODELING_DESIGN.md D20）。
        Args: plan。
        """
        try:
            estimator = (
                None
                if plan.artifact is None or self.store is None
                else await artifact_io.fetch(
                    self.store, plan.artifact, self.cache
                )
            )
            return compile_model(plan.serving, estimator=estimator)
        except ArtifactRejected as error:
            return AnalysisUnavailable(reason=str(error))
        except OperatorError as error:
            return AnalysisUnavailable(reason=str(error))

    async def _artifact(
        self, session: AsyncSession, version: ModelVersion
    ) -> dict[str, Any] | None:
        """通道 B 要下载的产物元信息；通道 A 给 `None`。

        Args: session, version。
        """
        if version.serving_channel != CHANNEL_BINARY:
            return None
        if self.store is None:
            raise ArtifactRejected("本部署没有配对象存储，这个模型用不了")
        row = await model_artifact_crud.get_by_version(session, version.id)
        if row is None:
            raise ArtifactRejected("这个模型版本没有留下模型产物，请重新发布")
        return {
            "object_key": row.object_key,
            "digest": row.digest,
            "format_version": row.format_version,
            "runtime": dict(row.runtime_json),
        }


def _refusal_of(
    version: ModelVersion, *, is_preview: bool
) -> AnalysisUnavailable | None:
    """这个版本用不了的原因；用得了给 None。

    Args: version, is_preview。
    """
    if not version.servable:
        return AnalysisUnavailable(
            reason=version.unservable_reason or "这个模型版本不可上线"
        )
    if is_preview and version.serving_channel != CHANNEL_JSON:
        return AnalysisUnavailable(
            reason="二进制模型请通过台账重算查看结果，公式预览暂不支持"
        )
    return None
