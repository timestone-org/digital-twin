"""这套部署的知识库接得了哪几种接入形态，以及对话档此刻落在哪一路上。

⚠ **形态 → 装配口子**的注册表是显式的一份字面量表（ADR-0029 决策四），不靠
import 副作用：隐式注册会让「接得了哪几种」取决于 import 顺序，而顺序在测试里
与生产里可以不同。接一种新形态 = 加一个装配口子 + 这张表里一行 + 一条契约测试。

⚠ 认不出的形态**如实缺席**而不是退回环境变量那一档：平台那边分配到一个这一侧
接不了的形态时，正确的行为是「说不出话」而不是静默改走另一路——后者的差异
只出现在账单上（ADR-0040 决策三同一口径）。

⚠ 环境变量那一档是目录的**永久默认值**（config-and-secrets §7.1）：目录里没给
`knowledge.chat` 分配时才轮到它。
"""

from collections.abc import Callable
from dataclasses import dataclass

from langchain_core.language_models import BaseChatModel

from knowledge_server.apps.knowledge.services.llm import ChatAdapter
from knowledge_server.llm_purposes import PURPOSE_CHAT
from knowledge_server.settings import Settings
from lib.logging import get_logger
from llmcore import (
    CODEX_EFFORTS,
    PROVIDER_KIND_CODEX_OAUTH,
    PROVIDER_KIND_OPENAI_COMPAT,
    CatalogSource,
    CodexOAuthAdapter,
    ModelCatalog,
    ModelChoice,
    ModelKind,
    OpenAiCompatAdapter,
    Resolved,
    TokenSource,
    effort_of,
)

_logger = get_logger("knowledge.llm.adapters")

# 请求头里的来路标识。⚠ 不留成上游默认的 "langchain"：出了事要能从对面的日志里
# 认出是本系统的哪一个服务发的
ORIGINATOR = "digitaltwin-knowledge"
# 那一路没配推理档位时用哪一档。⚠ 界面上这一侧不给人选，只认那一行上配的
DEFAULT_EFFORT = "medium"
# 环境变量那一档在能力面上的名字
ENV_LABEL = "知识库对话档"


@dataclass(frozen=True)
class AdapterDeps:
    """装一路对话档要的那几样。

    ⚠ 打成一包而不是逐个形参：装配口子的形状要全部形态共用，而每多接一种
    东西（目录、凭据面）就要改每一路的签名。
    """

    settings: Settings
    catalog: CatalogSource
    # 订阅账号那一路的令牌来源（platform 的内部凭据面）；没接就是 None
    tokens: TokenSource | None = None


# 把目录里解出来的那一路变成一个对话适配器。⚠ 接不上时给 `None` 而不是抛：
# 那一路就是没接，而整个服务在没接模型时仍然要能起、文档仍然要能摄取
ChatAdapterBuilder = Callable[
    [ModelCatalog, Resolved, AdapterDeps], ChatAdapter | None
]


def _endpoint(
    snapshot: ModelCatalog, found: Resolved, deps: AdapterDeps
) -> ChatAdapter | None:
    """按量计费的那一路。

    Args: snapshot, found, deps。
    """
    endpoint = snapshot.endpoint_on(
        found.provider, found.model, timeout_s=deps.settings.model_timeout_s
    )
    if endpoint is None:
        return None
    return OpenAiCompatAdapter(
        # ⚠ 每一档解出来的都是这一条：这一侧只有对话与折叠摘要两档，
        # 而它们打的是同一个端点
        resolve=lambda _kind: endpoint,
        label=found.provider.name,
        models=(found.model.name,),
        id=found.provider.id,
    )


def _codex(
    snapshot: ModelCatalog, found: Resolved, deps: AdapterDeps
) -> ChatAdapter | None:
    """订阅账号那一路（ADR-0041）。没接令牌来源时给 `None`。

    Args: snapshot, found, deps。
    """
    del snapshot
    if deps.tokens is None:
        return None
    return CodexOAuthAdapter(
        id=found.provider.id,
        label=found.provider.name,
        # ⚠ 用**分配指的那个**模型：这一路上可以登记好几个，挑第一个的话
        # 界面上改了分配、这一侧还在打老那一个
        models=(found.model.name,),
        default_effort=(
            effort_of(found.provider.options, CODEX_EFFORTS) or DEFAULT_EFFORT
        ),
        timeout_s=deps.settings.model_timeout_s,
        tokens=deps.tokens,
        originator=ORIGINATOR,
    )


# 形态 → 装配口子。⚠ 这张表就是「知识库接得了哪几种供应商」的全部答案
KIND_BUILDERS: dict[str, ChatAdapterBuilder] = {
    PROVIDER_KIND_OPENAI_COMPAT: _endpoint,
    PROVIDER_KIND_CODEX_OAUTH: _codex,
}


@dataclass(frozen=True)
class CatalogChatAdapter:
    """对话档：目录里分配了就走那一路，没分配退环境变量那一档。

    ⚠ 每次调用重新挑一次：目录是运行期可改的，装配时钉死的话，界面上改了分配
    要重启才生效，而现象是「配好了、知识库还在用老那一路」。
    """

    deps: AdapterDeps

    def current(self) -> ChatAdapter | None:
        """此刻走哪一路；一路都装不出来时给 `None`。"""
        snapshot = self.deps.catalog.snapshot()
        found = snapshot.resolve(PURPOSE_CHAT)
        if found is None:
            return _env_adapter(self.deps.settings)
        make = KIND_BUILDERS.get(found.provider.kind)
        if make is None:
            _logger.warning(
                "llm_provider_kind_unsupported",
                "分配到了这一侧接不了的接入形态，对话档如实缺席",
                kind=found.provider.kind,
            )
            return None
        return make(snapshot, found, self.deps)

    def is_codex_now(self) -> bool:
        """此刻这一路要不要改工具名的线形。

        ⚠ 问的是适配器自己而不是档位名：这一侧只有一个档位（`default`），
        而它背后走哪一路由目录说了算。按档位名比的话，配了订阅账号之后每一次
        带工具的对话都撞一条 400，而那条 400 里不会提到点号。
        """
        return isinstance(self.current(), CodexOAuthAdapter)

    def supports(self, kind: ModelKind) -> bool:
        """这一档此刻装得出模型吗。

        Args: kind。
        """
        made = self.current()
        return made is not None and made.supports(kind)

    async def build(self, choice: ModelChoice) -> BaseChatModel:
        """按这次选择造一个模型。

        Args: choice。
        """
        made = self.current()
        # pragma 理由：调用方在 `supports` 为假时不会走到这里
        if made is None:  # pragma: no cover
            raise ValueError("这一档没有装得出的对话模型")
        return await made.build(choice)


def _env_adapter(settings: Settings) -> ChatAdapter | None:
    """环境变量那一档；没配就是 `None`。

    Args: settings。
    """
    endpoint = settings.chat_endpoint()
    if endpoint is None:
        return None
    return OpenAiCompatAdapter(
        resolve=lambda _kind: endpoint,
        label=ENV_LABEL,
        models=(endpoint.model,),
    )
