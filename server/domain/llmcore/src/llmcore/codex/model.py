"""把订阅账号那一路拧成一个对话模型。

⚠ 用的是上游的 `_ChatOpenAICodex`（私有名，前导下划线）。它把后端那几条硬约束
焊死了——只走 Responses 面、`store=false`、必须流式、`SystemMessage` 提升进顶层
`instructions`——每一条都是后端 400 出来的，自己重写一遍等于把那几条再踩一次。
契约用例钉着这个名字与它强制的那几格。

⚠ 后端**要求 instructions 非空**，且**拒收 system 消息**。消费方的常驻提示词
本来就是一条 SystemMessage，上游会自动把它提上去，所以这里不另外传。
"""

from typing import Any

from langchain_core.language_models import BaseChatModel
from langchain_openai.chat_models import codex as upstream


def build_codex_model(
    *,
    model: str,
    token_provider: object,
    effort: str,
    timeout_s: float,
    originator: str,
) -> BaseChatModel:
    """按模型代号与推理档位造一个订阅账号那一路的模型。

    ⚠ 这一层**不重试**：一条链路只有一层负责重试，而那一层是编排层
    （runtime-resilience §4.2）。留着 SDK 自带的重试会让一次超时变成三次。

    Args: model, token_provider, effort, timeout_s, originator（请求头里的来路
        标识；由消费方给——出了事要能从对面的日志里认出是哪个服务发的，
        而这一层连自己叫什么都不该知道）。
    """
    extra: dict[str, Any] = {
        "token_provider": token_provider,
        "originator": originator,
        # 思考摘要要出得来，否则界面上那一路永远是空的
        "reasoning": {"effort": effort, "summary": "auto"},
        # 与 store=false 配套：不带它的话，多轮之间模型看不见自己上一轮想过什么
        "include": ["reasoning.encrypted_content"],
    }
    return upstream._ChatOpenAICodex(  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]  # 理由：见文件头
        model=model,
        timeout=timeout_s,
        max_retries=0,
        **extra,
    )
