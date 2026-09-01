"""助手自己那几路模型的档位名。共用词汇在 `llmcore`。

⚠ 这个文件**只留助手独有的那一格**（订阅账号那一路的档位名）。别的一律从
`llmcore` 再导出——两处各定义一份的话，`ModelChoice` 会有两个不同的类型，
而「传进去的对象类型不对」在运行期表现为一条看不懂的 pydantic 报错。
"""

from llmcore.ports import (
    DEFAULT_PROFILE,
    MODEL_KINDS,
    EmbeddingAdapter,
    ModelAdapter,
    ModelChoice,
    ModelKind,
    ModelProfile,
    ModelSource,
)

# 订阅账号那一路（ADR-0026）。⚠ 是线上契约的一部分：会话里存的就是这个字面量。
# ⚠ 留在助手而不是下沉：`llmcore` 里不许出现任何一路的具体来路名，
# 而这一路只有助手接
CODEX_PROFILE = "codex"

__all__ = [
    "CODEX_PROFILE",
    "DEFAULT_PROFILE",
    "MODEL_KINDS",
    "EmbeddingAdapter",
    "ModelAdapter",
    "ModelChoice",
    "ModelKind",
    "ModelProfile",
    "ModelSource",
]
