"""本模块的闭合集合：模型种类与用途清单。

⚠ 一律用 CHECK 约束而不是原生 ENUM（database-standard §3）。

⚠ 用途码是**跨服务契约**：助手侧与知识库侧各自复述自己那几条字面量去目录里
查，本服务不依赖它们（服务之间不许互相 import）。三侧逐字一致由前端的
`llm-shapes.contract.spec.ts` 对着三份源码比对；漂开的表现是「界面上分配了、
那一侧却还在用环境变量那一档」，而三边代码单看都对。
"""

from dataclasses import dataclass

# 与 llmcore 的 `MODEL_SPEC_KINDS` 逐字一致。嵌入模型与对话模型不通用，
# 拿对话模型名去打 embeddings 端点是一条必然失败的调用
MODEL_KIND_CHAT = "chat"
MODEL_KIND_EMBEDDING = "embedding"
MODEL_KINDS = (MODEL_KIND_CHAT, MODEL_KIND_EMBEDDING)

# 用途属于哪一个消费方，界面按它分组
CONSUMER_ASSISTANT = "assistant"
CONSUMER_KNOWLEDGE = "knowledge"
CONSUMERS = (CONSUMER_ASSISTANT, CONSUMER_KNOWLEDGE)


@dataclass(frozen=True)
class PurposeSpec:
    """一个用途在目录上的样子。"""

    code: str
    label: str
    description: str
    # 这个用途吃哪一种模型
    kind: str
    consumer: str
    # 只有接图的模型才配得上它
    is_vision_required: bool = False


PURPOSES: tuple[PurposeSpec, ...] = (
    PurposeSpec(
        code="assistant.chat",
        label="对话",
        description="助手每一轮对话走的模型；也是工具调用与计划循环用的那一路",
        kind=MODEL_KIND_CHAT,
        consumer=CONSUMER_ASSISTANT,
    ),
    PurposeSpec(
        code="assistant.vision",
        label="看图",
        description="带截图的那一轮走的模型；单价与延迟都高得多，只在需要时才用",
        kind=MODEL_KIND_CHAT,
        consumer=CONSUMER_ASSISTANT,
        is_vision_required=True,
    ),
    PurposeSpec(
        code="assistant.summary",
        label="折叠摘要",
        description="把滑出窗口的旧对话折成一段摘要的后台调用，可以用便宜的模型",
        kind=MODEL_KIND_CHAT,
        consumer=CONSUMER_ASSISTANT,
    ),
    PurposeSpec(
        code="assistant.embedding",
        label="长期记忆嵌入",
        description="助手记住的口径按它转成向量做检索；换模型会让旧向量作废",
        kind=MODEL_KIND_EMBEDDING,
        consumer=CONSUMER_ASSISTANT,
    ),
    PurposeSpec(
        code="knowledge.chat",
        label="对话与 agentic 检索",
        description="知识库对话页与 agentic 检索策略共用的模型",
        kind=MODEL_KIND_CHAT,
        consumer=CONSUMER_KNOWLEDGE,
    ),
    PurposeSpec(
        code="knowledge.embedding",
        label="文档嵌入",
        description="文档切块后按它转成向量；已建库的向量钉在建库那一刻的模型上",
        kind=MODEL_KIND_EMBEDDING,
        consumer=CONSUMER_KNOWLEDGE,
    ),
)

PURPOSE_CODES: tuple[str, ...] = tuple(one.code for one in PURPOSES)


def purpose_of(code: str) -> PurposeSpec | None:
    """按码取用途；未登记给 `None`。

    Args: code。
    """
    return next((one for one in PURPOSES if one.code == code), None)


def sql_values(values: tuple[str, ...]) -> str:
    """把闭合集合摊成 CHECK 约束里的值列表。

    Args: values。
    """
    return ", ".join(f"'{value}'" for value in values)
