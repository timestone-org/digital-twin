"""截图在一个回合里怎么走。

⚠ 图**只活在这一轮**。落库的是一句占位，不是那几兆字节的 base64：全存下来的话，
一个看过几次图的会话每次重放都要把它们再喂给模型一遍，上下文与账单一起翻倍，
而模型早在当时就把结论写成文字了。所以看完必须当场把结论说出来——下一轮它
只看得见一句占位。

⚠ 工具消息里**不放图**。OpenAI 兼容口径只认用户消息里的图片块；塞进工具消息
多半被整条丢掉，表现是模型说「我没看到图」，而调用明明成功了。所以工具消息
回一句「图在下一条」，图另起一条用户消息。
"""

from langchain_core.messages import BaseMessage, HumanMessage

# 落库与重放时代替图本身的那句话
PLACEHOLDER = "[截图]"

_PREFIX = "data:image/"

# 跟在工具消息里的那句话。图另起一条，这里只交代它在哪
HANDOFF = "截图好了，图在下一条消息里。"


def is_image(value: object) -> bool:
    """这个工具产出是不是一张内嵌的图。

    Args: value。
    """
    return isinstance(value, str) and value.startswith(_PREFIX)


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
