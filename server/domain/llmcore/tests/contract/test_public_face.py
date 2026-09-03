"""再导出面与协议契约。

⚠ 这一包对外**只认 `__init__` 那份清单**：内部形状可以随时改，而消费方绕过它
直接 import 子模块的话，一次内部重命名就会打穿两个服务——而结构闸看不见
这种越界（它只判服务与 domain 的方向，不判 domain 包内部）。

⚠ 注册的实现都要真满足协议。不钉这一条的话，注册表本身就成了新的静默失效点：
一个少写了 `profile()` 的适配器装得进去，只在被选中的那一次才炸。
"""

import llmcore
from llmcore.codex.adapter import CodexOAuthAdapter
from llmcore.openai_compat import OpenAiCompatAdapter
from llmcore.openai_embedding import OpenAiCompatEmbeddingAdapter
from llmcore.ports import EmbeddingAdapter, ModelAdapter
from llmcore.rerank import DynamicRerankAdapter, Reranker

# 消费方按这份名单 import。少一个就是有人得绕过再导出面
REQUIRED = (
    "CATALOG_PATH",
    "CODEX_LEASE_PATH",
    "PROVIDER_KIND_CODEX_OAUTH",
    "PROVIDER_KIND_OPENAI_COMPAT",
    "CodexOAuthAdapter",
    "CodexRewire",
    "CodexTokenClient",
    "CredentialNotConnected",
    "CatalogCache",
    "CatalogClient",
    "CatalogSource",
    "ChatEndpoint",
    "DeltaChannel",
    "DeltaSink",
    "DynamicEmbeddingAdapter",
    "DynamicRerankAdapter",
    "EmbeddingAdapter",
    "ModelCatalog",
    "EmbeddingEndpoint",
    "RerankEndpoint",
    "RerankScore",
    "RerankUnavailable",
    "Reranker",
    "RERANK_DIALECTS",
    "OPTION_RERANK_DIALECT",
    "classified_status",
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
    "StoredTokenProvider",
    "TokenSource",
    "build_codex_model",
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


def test_the_codex_adapter_satisfies_the_protocol() -> None:
    """⚠ 订阅账号那一路与端点那一路装进的是同一张注册表：少写一个方法的那个
    装得进去，只在被选中的那一次才炸。"""
    made = CodexOAuthAdapter(
        id="p1",
        label="订阅账号",
        models=("gpt-5",),
        default_effort="medium",
        timeout_s=1.0,
        tokens=_NoTokens(),
        originator="tests",
    )
    assert isinstance(made, ModelAdapter)


class _NoTokens:
    """一个不会被调到的令牌来源：这条用例只验形状。"""

    async def usable(self, provider: str) -> object:
        raise AssertionError(provider)


def test_the_embedding_adapter_satisfies_the_protocol() -> None:
    made = OpenAiCompatEmbeddingAdapter(
        client=None,  # pyright: ignore[reportArgumentType]
        model="m",
        dimensions=1,
    )
    assert isinstance(made, EmbeddingAdapter)


def test_the_rerank_adapter_satisfies_the_protocol() -> None:
    made = DynamicRerankAdapter(resolve=lambda: None)
    assert isinstance(made, Reranker)


# 线形方言的**实现文件**：它们的名字天然带着定义这套线形的人的名字，
# `openai_compat` 已是先例。别处一律不许出现厂商名
_DIALECT_FILES = (
    "rerank/jina.py",
    "rerank/dashscope.py",
    "rerank/registry.py",
    "rerank/__init__.py",
)


def test_this_package_names_no_vendor() -> None:
    """⚠ 零厂商名是这一包能住在 domain 的前提：端点、模型名、超时全从调用方
    传进来，换供应商是改一行配置而不是改代码。

    ⚠ 扫的是整棵树而不是顶层那几个文件：只扫顶层的话，往子包里写一句写死某家
    的分支照样全绿，而那正是这条闸要拦的事。
    """
    root = __import__("pathlib").Path(llmcore.__file__).parent
    banned = ("dashscope", "aliyun", "百炼", "azure", "anthropic")
    hits = [
        f"{path.relative_to(root)}:{word}"
        for path in root.rglob("*.py")
        if path.relative_to(root).as_posix() not in _DIALECT_FILES
        for word in banned
        if word in path.read_text(encoding="utf-8").lower()
    ]
    assert hits == []


def test_no_dialect_file_hardcodes_an_endpoint() -> None:
    """⚠ 方言文件许它带厂商名（那是线形的名字），但**不许带地址**：带了地址
    就等于把「打哪」写死进了 domain，而那一格本该从配置来。"""
    root = __import__("pathlib").Path(llmcore.__file__).parent
    hits = [
        one
        for one in _DIALECT_FILES
        if "://" in (root / one).read_text(encoding="utf-8")
    ]
    assert hits == []
