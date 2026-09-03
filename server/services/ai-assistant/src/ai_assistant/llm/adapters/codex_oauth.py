"""订阅账号那一形态：用 ChatGPT 订阅直连 Codex 后端（ADR-0026）。

适配器本身在 `llmcore.codex`（知识库也接这一路，ADR-0041）；这里只回答
「目录里的一路供应商怎么变成本服务的一个适配器」——模型清单、推理档位与
来路标识从哪儿来。

⚠ 登录态**不在本服务**：它归 platform，与那一路供应商同属主。这里拿到的是一个
「领令牌」的口子；没接那个口子时这一路如实缺席，而不是装出一个点了报错的档位。
"""

from ai_assistant.llm.ports import CODEX_EFFORTS
from ai_assistant.settings import Settings
from llmcore import (
    MODEL_KIND_CHAT,
    CodexOAuthAdapter,
    ProviderSpec,
    TokenSource,
    effort_of,
)

# 请求头里的来路标识。⚠ 不留成上游默认的 "langchain"：出了事要能从对面的日志里
# 认出是本系统发的
ORIGINATOR = "digitaltwin-assistant"


def build_catalog_codex(
    provider: ProviderSpec, settings: Settings, tokens: TokenSource | None
) -> CodexOAuthAdapter | None:
    """目录里的一路订阅账号。没接凭据面时给 `None`——那时令牌无处可领。

    Args: provider, settings, tokens。
    """
    if tokens is None:
        return None
    return CodexOAuthAdapter(
        id=provider.id,
        label=provider.name,
        models=tuple(one.name for one in provider.models_of(MODEL_KIND_CHAT)),
        default_effort=(
            effort_of(provider.options, CODEX_EFFORTS)
            or settings.codex_reasoning_effort
        ),
        timeout_s=settings.model_timeout_s,
        tokens=tokens,
        originator=ORIGINATOR,
        efforts=CODEX_EFFORTS,
    )
