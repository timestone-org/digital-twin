"""订阅账号那一路（`codex_oauth`）的共用件：模型构造、令牌来源、适配器。

两个消费方（助手与知识库）接的是同一条私有面，差别只在「模型清单与推理档位
从哪儿来」。复制一份一定会漂，而漂的表现是「同一个订阅账号，助手说得了话、
知识库说不了」（ADR-0041）。

⚠ **刷新令牌不在这一层**：刷新是写操作，属主只有平台一个。这里只「领」，
不「刷」——两个消费方各自刷新同一个 refresh_token 会互相把对方的令牌作废，
而现象是「用着用着就掉登录」。
"""

from llmcore.codex.adapter import (
    CODEX_EFFORTS,
    OPTION_DEFAULT_EFFORT,
    CodexOAuthAdapter,
    effort_of,
)
from llmcore.codex.client import (
    CODEX_LEASE_PATH,
    CodexTokenClient,
    CredentialNotConnected,
    CredentialUnavailable,
)
from llmcore.codex.model import build_codex_model
from llmcore.codex.rewire import CodexRewire, IsCodex
from llmcore.codex.tokens import (
    StoredTokenProvider,
    TokenSource,
    UsableToken,
)

__all__ = [
    "CODEX_EFFORTS",
    "CODEX_LEASE_PATH",
    "OPTION_DEFAULT_EFFORT",
    "CodexOAuthAdapter",
    "CodexRewire",
    "CodexTokenClient",
    "CredentialNotConnected",
    "CredentialUnavailable",
    "IsCodex",
    "StoredTokenProvider",
    "TokenSource",
    "UsableToken",
    "build_codex_model",
    "effort_of",
]
