"""订阅账号那一形态的适配器：用订阅直连私有面，不按 token 计费。

目录里配出来的每一路各是一个适配器，两个消费方装的是同一个类型——差别只在
「模型清单、推理档位与来路标识从哪儿来」，接法一模一样。

⚠ **这一路不接图。** `supports("vision")` 恒假，由调用方据此如实拒绝——
截图那条链路只在端点那一形态上验过。放行的话，图会被喂给一个自报不接图的
模型，而它多半只回一句「我没看到图」：调用成功、照常计费、结论是错的。

⚠ 登录态**不在目录里**：令牌要在每次调用前可续期，故它落在平台的凭据表上，
按那一路供应商的 id 认行（ADR-0041）。这一层只认一个「领令牌」的口子。
"""

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from langchain_core.language_models import BaseChatModel

from llmcore.codex.model import build_codex_model
from llmcore.codex.tokens import StoredTokenProvider, TokenSource
from llmcore.ports import ModelChoice, ModelKind, ModelProfile

# 推理档位配在形态自己那几格里。⚠ 与 platform-server 的
# `apps/llm_providers/rules.py` 逐字一致：拼错的那一格读不出来，
# 表现是「配了 high、发出去的还是 medium」
OPTION_DEFAULT_EFFORT = "default_effort"

# 这一路吃得下的那几档。⚠ 摘要档也吃：折叠是一次纯文本调用，这一路做得了。
# 不吃的话，一个只登录了订阅账号的部署永远折不出摘要，而它表现为
# 「摘要偶尔就是没有」
_KINDS: tuple[ModelKind, ...] = ("chat", "summary")


@dataclass(frozen=True)
class CodexOAuthAdapter:
    """一路订阅账号。"""

    id: str
    label: str
    models: tuple[str, ...]
    # 没在这次调用里选档位时用哪一档
    default_effort: str
    timeout_s: float
    tokens: TokenSource
    # 请求头里的来路标识。⚠ 由消费方给：出了事要能从对面的日志里认出是哪个
    # 服务发的，而这一层连自己在哪个服务里都不该知道
    originator: str
    # 界面上摆得出来的推理档位；空表示这一侧不给人选
    efforts: tuple[str, ...] = field(default=())

    def supports(self, kind: ModelKind) -> bool:
        """吃对话档与摘要档，不吃视觉档。

        ⚠ 一个模型都没登记的那一路**哪一档都不吃**：发一次空模型名过去是一条
        400，而那条 400 里不会提到是「这一路上还没登记模型」。

        Args: kind。
        """
        return bool(self.models) and kind in _KINDS

    async def build(self, choice: ModelChoice) -> BaseChatModel:
        """先领一次令牌，再造模型。

        ⚠ 先领令牌：没登录过就在这里失败，而不是等模型端点回 401——后者报出来
        的是「模型暂时不可用」，与「去登录一下」完全对不上。

        Args: choice。
        """
        seed = await self.tokens.usable(self.id)
        return build_codex_model(
            model=self.models[0],
            # ⚠ 刚领到的那一份直接当快照：上游把 api_key 焊成同步可调用件，
            # 第一次请求会从执行器线程回来要它
            token_provider=StoredTokenProvider(self.tokens, self.id, seed=seed),
            effort=choice.effort or self.default_effort,
            timeout_s=self.timeout_s,
            originator=self.originator,
        )

    def profile(self) -> ModelProfile:
        """这一路在能力面上的样子。"""
        return ModelProfile(
            id=self.id,
            label=self.label,
            # ⚠ 装配得起来不代表登录过：真假由凭据面在能力端点上补
            is_ready=True,
            # 这一路眼下不接图：截图那条链路只在端点那一形态上验过
            has_vision=False,
            models=self.models,
            efforts=self.efforts,
        )


def effort_of(
    options: Mapping[str, Any] | None, allowed: tuple[str, ...]
) -> str | None:
    """这一路配的推理档位；没配或配得不成形时给 `None`。

    ⚠ 防着读：这一格要原样进请求体，塞个数字进去是一条 400，
    而那条 400 里不会提到是哪一格。

    Args: options, allowed（这一侧认的那几档）。
    """
    if not options:
        return None
    found = options.get(OPTION_DEFAULT_EFFORT)
    if not isinstance(found, str) or found not in allowed:
        return None
    return found
