"""台账那个抽象的建模实现：按公式标识把模型版本编译成可调用对象。

⚠ 依赖方向：本模块编译期认识 `apps/dataset`，反过来永远不认识。装配点在
`app.py` 与 `worker.py` **两处**——注册表是进程内的，而重算可能落到任意 API
副本、也可能跑在 worker 上（docs/MODELING_DESIGN.md §3.2）。
⚠ 每批只查一次库：单行写触发的重算批量恒为 1，每批的固定开销必须小。
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from functools import partial

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
        """一次装一批。查一次绑定、查一次版本，其余全是纯计算。

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
        prepared: dict[str, _Servable | AnalysisUnavailable] = {}
        async with sessions.session() as session:
            bindings = await binding_crud.list_by_codes(
                session, tuple(sorted(codes))
            )
            found = {binding.fx_code: binding for binding in bindings}
            for code in codes:
                prepared[code] = await self._one(
                    session, found.get(code), is_preview=is_preview
                )
        # ⚠ 读对象存储必须等上面的事务释放：存储变慢时不能占着数据库连接等它
        loaded: dict[str, AnalysisModel | AnalysisUnavailable] = {}
        for code, item in prepared.items():
            loaded[code] = (
                await _compiled(item) if isinstance(item, _Servable) else item
            )
        return loaded

    async def _one(
        self,
        session: AsyncSession,
        binding: ModelingBinding | None,
        *,
        is_preview: bool,
    ) -> "_Servable | AnalysisUnavailable":
        """一条绑定要编译的材料，或一句用不了的原因。

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
        if not version.servable:
            return AnalysisUnavailable(
                reason=version.unservable_reason or "这个模型版本不可上线"
            )
        return await self._servable(session, version, is_preview=is_preview)

    async def _servable(
        self,
        session: AsyncSession,
        version: ModelVersion,
        *,
        is_preview: bool,
    ) -> "_Servable | AnalysisUnavailable":
        """把编译要的东西从库里取齐。通道 B 只取产物元信息，不碰字节。

        Args: session, version, is_preview。
        """
        if is_preview and version.serving_channel != CHANNEL_JSON:
            return AnalysisUnavailable(
                reason="二进制模型请通过台账重算查看结果，公式预览暂不支持"
            )
        serving = dict(version.serving_json)
        if version.serving_channel != CHANNEL_BINARY:
            return _Servable(serving=serving)
        if self.store is None:
            return AnalysisUnavailable(
                reason="本部署没有配对象存储，这个模型用不了"
            )
        row = await model_artifact_crud.get_by_version(session, version.id)
        if row is None:
            return AnalysisUnavailable(
                reason="这个模型版本没有留下模型产物，请重新发布"
            )
        return _Servable(
            serving=serving,
            fetch=partial(
                artifact_io.fetch,
                self.store,
                {
                    "object_key": row.object_key,
                    "digest": row.digest,
                    "format_version": row.format_version,
                    "runtime": dict(row.runtime_json),
                },
                self.cache,
            ),
        )


@dataclass(frozen=True)
class _Servable:
    """离开事务后编译一个版本要的全部材料，不含 ORM 行。"""

    serving: dict[str, object]
    #: 把通道 B 的模型本体装回来。通道 A 没有这一步
    fetch: Callable[[], Awaitable[object]] | None = None


async def _compiled(item: _Servable) -> AnalysisModel | AnalysisUnavailable:
    """编译一个版本。通道 B 先把模型本体从对象存储装回来。

    ⚠ 加载放在**取数相位**：编译出来的东西在求值期只做算术，那里一次 I/O
    都不许有（docs/MODELING_DESIGN.md D20）。
    Args: item。
    """
    try:
        estimator = None if item.fetch is None else await item.fetch()
        return compile_model(item.serving, estimator=estimator)
    except ArtifactRejected as error:
        return AnalysisUnavailable(reason=str(error))
    except OperatorError as error:
        return AnalysisUnavailable(reason=str(error))
