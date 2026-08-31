"""截图在一个回合里怎么走。

⚠ 图**只活在这一轮**。落库的是一句占位，不是那几兆字节的 base64：全存下来的话，
一个看过几次图的会话每次重放都要把它们再喂给模型一遍，上下文与账单一起翻倍，
而模型早在当时就把结论写成文字了。所以看完必须当场把结论说出来——下一轮它
只看得见一句占位。

⚠ 工具消息里**不放图**。OpenAI 兼容口径只认用户消息里的图片块；塞进工具消息
多半被整条丢掉，表现是模型说「我没看到图」，而调用明明成功了。所以工具消息
回一句「图在下一条」，图另起一条用户消息。
"""

from typing import Any

from langchain_core.messages import BaseMessage, HumanMessage

# 落库与重放时代替图本身的那句话。⚠ 说「图片」而不是「截图」：用户贴进来的
# 图与助手自己截的图共用这一句，写成「截图」会让模型以为那张照片是它自己截的
PLACEHOLDER = "[图片]"

_PREFIX = "data:image/"

# 跟在工具消息里的那句话。图另起一条，这里只交代它在哪
HANDOFF = "截图好了，图在下一条消息里。"


def is_image(value: object) -> bool:
    """这个工具产出是不是一张内嵌的图。

    Args: value。
    """
    return isinstance(value, str) and value.startswith(_PREFIX)


def user_message(text: str, uris: list[str]) -> BaseMessage:
    """用户这一句话，外加他贴的几张图。

    ⚠ 没有图时回一条**纯字符串**的消息，不是只有一个文字块的列表：两者喂给
    端点是等价的，但落库与重放的路径只对前者验过，改形状等于把那条路重走一遍。

    Args: text, uris（`data:image/...;base64,...`，已过解码器的白名单）。
    """
    if not uris:
        return HumanMessage(content=text)
    # ⚠ 标成 `str | dict` 的列表而不是 `list[dict[...]]`：上游那一格是不变量
    # 泛型，窄一点的元素类型直接判不兼容
    blocks: list[str | dict[Any, Any]] = [{"type": "text", "text": text}]
    blocks.extend(
        {"type": "image_url", "image_url": {"url": one}} for one in uris
    )
    return HumanMessage(content=blocks)


def image_message(uri: str) -> BaseMessage:
    """把一张图包成模型认的一条用户消息。

    Args: uri（`data:image/...;base64,...`）。
    """
    return HumanMessage(
        content=[
            {"type": "text", "text": "这是当前画布的截图。"},
            {"type": "image_url", "image_url": {"url": uri}},
        ]
    )
