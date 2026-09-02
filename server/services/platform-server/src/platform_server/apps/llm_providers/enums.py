"""本模块的闭合集合：模型种类、供应商的接入形态与用途清单。

⚠ 一律用 CHECK 约束而不是原生 ENUM（database-standard §3）。

⚠ 用途码是**跨服务契约**：助手侧与知识库侧各自复述自己那几条字面量去目录里
查，本服务不依赖它们（服务之间不许互相 import）。三侧逐字一致由前端的
`llm-shapes.contract.spec.ts` 对着三份源码比对；漂开的表现是「界面上分配了、
那一侧却还在用环境变量那一档」，而三边代码单看都对。

⚠ 接入形态同理是跨服务契约：助手复述自己接得了的那几档，前端按它渲染表单。
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

# 一路供应商的**接入形态**：它决定这一路要配什么、由谁接得了，也决定消费方
# 那一侧拿哪一个适配器去接。⚠ 形态是**行为**不是取值——加一种形态一定要有一个
# 消费方真接得了它，光在这里加一档只会让界面配得出、那一侧一句话都说不出来
PROVIDER_KIND_OPENAI_COMPAT = "openai_compat"
PROVIDER_KIND_CODEX_OAUTH = "codex_oauth"


@dataclass(frozen=True)
class ProviderPreset:
    """建一路供应商时能一键填上的一套取值。纯便利，不入库。"""

    code: str
    label: str
    base_url: str


@dataclass(frozen=True)
class ProviderKindSpec:
    """一种接入形态在目录上的样子：配什么、接得了什么。"""

    code: str
    label: str
    description: str
    # 要不要填端点与密钥。⚠ 为假的那些形态靠登录拿令牌，密钥格在界面上整个
    # 不出现——摆一个填了也没人读的框，比不摆更难解释
    is_endpoint_required: bool
    # 要不要先走一次登录。⚠ 登录态在**消费方**那一侧（令牌要在每次调用前
    # 可续期），目录里只记「这一路是要登录的」
    is_login_required: bool
    # 这一形态登记得了哪几种模型
    model_kinds: tuple[str, ...]
    # 哪几个消费方接得了这一形态。⚠ 分配时按它拦：指给一个接不了它的消费方，
    # 表现是「界面上分配了、那一侧却一直在用环境变量那一档」
    consumers: tuple[str, ...]
    # 可调的推理档位；空表示这一形态没有这一档
    efforts: tuple[str, ...] = ()
    presets: tuple[ProviderPreset, ...] = ()


# ⚠ 推理档位与助手的 `REASONING_EFFORTS` 逐字一致：漂开的表现是界面上选得中
# 的档位被端点回一条 400，而那条 400 里不会提到是哪一格
CODEX_EFFORTS = ("low", "medium", "high", "xhigh")

PROVIDER_KINDS: tuple[ProviderKindSpec, ...] = (
    ProviderKindSpec(
        code=PROVIDER_KIND_OPENAI_COMPAT,
        label="OpenAI 兼容端点",
        description=(
            "按 token 计费的 API Key 那一路：填端点地址与密钥，"
            "登记这一路上要用的几个模型。阿里云百炼就是这一种"
        ),
        is_endpoint_required=True,
        is_login_required=False,
        model_kinds=MODEL_KINDS,
        consumers=CONSUMERS,
        presets=(
            ProviderPreset(
                code="dashscope",
                label="阿里云百炼",
                # ⚠ 只是个起手值：百炼现在推业务空间专属域名，形如
                # `https://{业务空间id}.cn-beijing.maas.aliyuncs.com/…`，
                # 那一段只有部署方自己知道
                base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            ),
        ),
    ),
    ProviderKindSpec(
        code=PROVIDER_KIND_CODEX_OAUTH,
        label="Codex 订阅",
        description=(
            "用 ChatGPT 订阅账号直连 Codex 后端，不按 token 计费：不填密钥，"
            "改为在这一行上走一次设备码登录。只有助手接得了这一路，且它不接图"
        ),
        is_endpoint_required=False,
        is_login_required=True,
        # ⚠ 只有对话模型：这一路打的不是 embeddings 端点，登记了也没人读得到
        model_kinds=(MODEL_KIND_CHAT,),
        # ⚠ 知识库没接这一路的适配器；放行的话分配得上、那一侧永远沿用环境变量
        consumers=(CONSUMER_ASSISTANT,),
        efforts=CODEX_EFFORTS,
    ),
)

PROVIDER_KIND_CODES: tuple[str, ...] = tuple(one.code for one in PROVIDER_KINDS)


def provider_kind_of(code: str) -> ProviderKindSpec | None:
    """按码取形态；未登记给 `None`。

    Args: code。
    """
    return next((one for one in PROVIDER_KINDS if one.code == code), None)


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
