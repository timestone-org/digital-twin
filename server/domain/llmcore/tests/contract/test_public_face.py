"""再导出面与协议契约。

⚠ 这一包对外**只认 `__init__` 那份清单**：内部形状可以随时改，而消费方绕过它
直接 import 子模块的话，一次内部重命名就会打穿两个服务——而结构闸看不见
这种越界（它只判服务与 domain 的方向，不判 domain 包内部）。

⚠ 注册的实现都要真满足协议。不钉这一条的话，注册表本身就成了新的静默失效点：
一个少写了 `profile()` 的适配器装得进去，只在被选中的那一次才炸。
"""

import llmcore
from llmcore.openai_compat import OpenAiCompatAdapter
from llmcore.openai_embedding import OpenAiCompatEmbeddingAdapter
from llmcore.ports import EmbeddingAdapter, ModelAdapter

# 消费方按这份名单 import。少一个就是有人得绕过再导出面
REQUIRED = (
    "ChatEndpoint",
    "DeltaChannel",
    "DeltaSink",
    "EmbeddingAdapter",
    "EmbeddingEndpoint",
    "ModelAdapter",
    "ModelChoice",
    "ModelDisabled",
    "ModelKind",
    "ModelProfile",
    "ModelRejected",
    "ModelSource",
    "ModelUnavailable",
    "OpenAiCompatAdapter",
    "OpenAiCompatEmbeddingAdapter",
    "ReasoningChatOpenAI",
    "build_openai_embedding",
    "classified",
    "reason_of",
)


def test_the_public_face_exports_everything_consumers_need() -> None:
    missing = [name for name in REQUIRED if name not in llmcore.__all__]
    assert missing == []


def test_everything_in_all_is_actually_importable() -> None:
    """⚠ `__all__` 里写了个不存在的名字，`from llmcore import *` 才会炸，
    而没有人这么写——于是它会一直烂在那里。"""
    missing = [name for name in llmcore.__all__ if not hasattr(llmcore, name)]
    assert missing == []


def test_the_chat_adapter_satisfies_the_protocol() -> None:
    assert isinstance(
        OpenAiCompatAdapter(resolve=lambda _kind: None, label="", models=()),
        ModelAdapter,
    )


def test_the_embedding_adapter_satisfies_the_protocol() -> None:
    made = OpenAiCompatEmbeddingAdapter(
        client=None,  # pyright: ignore[reportArgumentType]
        model="m",
        dimensions=1,
    )
    assert isinstance(made, EmbeddingAdapter)


def test_this_package_names_no_vendor() -> None:
    """⚠ 零厂商名是这一包能住在 domain 的前提：端点、模型名、超时全从调用方
    传进来，换供应商是改一行配置而不是改代码。"""
    root = __import__("pathlib").Path(llmcore.__file__).parent
    banned = ("dashscope", "aliyun", "百炼", "azure", "anthropic")
    hits = [
        f"{path.name}:{word}"
        for path in root.glob("*.py")
        for word in banned
        if word in path.read_text(encoding="utf-8").lower()
    ]
    assert hits == []
