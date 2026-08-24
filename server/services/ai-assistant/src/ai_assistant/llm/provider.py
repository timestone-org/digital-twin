"""模型接入：把配置拧成一个 OpenAI 兼容的对话模型。

⚠ 代码里**不认任何厂商名**。端点、模型名、超时全从配置来——换供应商是改一行
配置而不是改代码（config-and-secrets §6：环境差异只能是取值不能是行为）。

⚠ 模型没开时**不造对象、也不抛**：造不出来这件事由调用方按「能力缺席」处理，
与前端那套 ports 范式同一口径。抛在装配期会让整个服务起不来，而会话历史
在没有模型时仍然要能读。
"""

from typing import Literal, Protocol

from langchain_core.language_models import BaseChatModel
from langchain_openai import ChatOpenAI

from ai_assistant.settings import Settings

# 对话用与看图用分两档：视觉模型的单价与延迟都高得多，混成一档等于每次
# 对话都按视觉计费
ModelKind = Literal["chat", "vision"]


class ChatModelSource(Protocol):
    """按用途取一个模型。测试注一个假的进来，不打真端点。"""

    def __call__(self, kind: ModelKind) -> BaseChatModel: ...


def build_model_source(settings: Settings) -> ChatModelSource | None:
    """按配置造模型工厂；没开模型时给 `None`。

    Args: settings。
    """
    key = settings.model_api_key
    if not settings.model_enabled or key is None:
        return None

    def source(kind: ModelKind) -> BaseChatModel:
        return ChatOpenAI(
            base_url=settings.model_base_url,
            api_key=key,
            model=_name_of(settings, kind),
            timeout=settings.model_timeout_s,
            # ⚠ 这一层不重试：一条链路只有一层负责重试，而那一层是编排层
            # （runtime-resilience §4.2）。留着 SDK 自带的重试会让一次超时
            # 变成三次，把上游的预算悄悄用光
            max_retries=0,
        )

    return source


def _name_of(settings: Settings, kind: ModelKind) -> str:
    return settings.model_vision if kind == "vision" else settings.model_chat
