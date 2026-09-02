"""助手自己那几路模型的档位名。共用词汇在 `llmcore`。

⚠ 这个文件**只留助手独有的那几格**（订阅账号那一路的名字、目录里的形态码与
用途码）。别的一律从 `llmcore` 再导出——两处各定义一份的话，`ModelChoice` 会有
两个不同的类型，而「传进去的对象类型不对」在运行期表现为一条看不懂的
pydantic 报错。
"""

from llmcore import PROVIDER_KIND_OPENAI_COMPAT
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

# 环境变量配出来的那一路订阅账号的档位名（ADR-0026）。⚠ 是线上契约的一部分：
# 会话里存的就是这个字面量，凭据行认的也是它。
# ⚠ 留在助手而不是下沉：`llmcore` 里不许出现任何一路的具体来路名，
# 而这一路只有助手接
CODEX_PROFILE = "codex"

# 目录里那几种接入形态（ADR-0040）。⚠ 与 platform-server 的
# `apps/llm_providers/enums.py` 逐字一致：漂开的表现是「界面上配好了一路
# Codex、助手却当它不存在」，而两边代码单看都对。
# ⚠ 端点那一形态的名字从 `llmcore` 再导出——它是协议名不是厂商名，
# 两个消费方共用
PROVIDER_KIND_CODEX_OAUTH = "codex_oauth"

# 订阅账号那一路可调的推理档位。⚠ 与 `settings.REASONING_EFFORTS` 同源，
# 也与平台侧那一份逐字一致：漂开的话界面上选得中的档位被端点回一条 400
CODEX_EFFORTS = ("low", "medium", "high", "xhigh")

# 模型目录里本服务那几个用途的码（ADR-0039）。⚠ 与 platform-server 的
# `apps/llm_providers/enums.py` 逐字一致，由前端的契约用例对着三份源码比对：
# 漂开的表现是「界面上分配了、这一侧却还在用环境变量那一档」
PURPOSE_CHAT = "assistant.chat"
PURPOSE_VISION = "assistant.vision"
PURPOSE_SUMMARY = "assistant.summary"
PURPOSE_EMBEDDING = "assistant.embedding"
# 每一档对应目录里哪个用途。⚠ 查表而不是拼字符串：拼出来的名字漂了不报错
PURPOSE_OF_KIND: dict[ModelKind, str] = {
    "chat": PURPOSE_CHAT,
    "vision": PURPOSE_VISION,
    "summary": PURPOSE_SUMMARY,
}

__all__ = [
    "CODEX_EFFORTS",
    "CODEX_PROFILE",
    "DEFAULT_PROFILE",
    "MODEL_KINDS",
    "PROVIDER_KIND_CODEX_OAUTH",
    "PROVIDER_KIND_OPENAI_COMPAT",
    "PURPOSE_CHAT",
    "PURPOSE_EMBEDDING",
    "PURPOSE_OF_KIND",
    "PURPOSE_SUMMARY",
    "PURPOSE_VISION",
    "EmbeddingAdapter",
    "ModelAdapter",
    "ModelChoice",
    "ModelKind",
    "ModelProfile",
    "ModelSource",
]
