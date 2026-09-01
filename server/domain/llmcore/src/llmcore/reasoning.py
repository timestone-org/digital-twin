"""保住端点吐出来的**思考过程**。

⚠ `langchain-openai` 明说自己只认官方 OpenAI 规范，第三方端点加的
`reasoning_content` 一律丢弃（它的模块文档头就写着这句）。而助手最要紧的
承诺是「一步一步看得见」，模型想的那十几秒正是最长的一段空白——丢了它，
用户看到的就是一个转了半分钟然后突然给出结论的黑箱。

⚠ 这是本服务唯一一处踩在库的私有接缝上。选它是因为它是**唯一**还拿得到原始
delta 的地方：再往上一层，那一格已经被丢掉了。库升级改了它的表现是「思考过程
静默消失」而不是崩，所以有一条用例直接钉这个方法的签名与行为——签名一变，
用例当场红，而不是等现场发现助手不再会思考了。

⚠ 它**不认厂商**：`reasoning_content` 是 OpenAI 兼容方言里的字段名，端点不吐
这一格时这一层就是个透明壳（`config-and-secrets §6`）。
"""

from typing import Any, cast

from langchain_core.outputs import ChatGenerationChunk
from langchain_openai import ChatOpenAI

from llmcore.deltas import REASONING_KEY


class ReasoningChatOpenAI(ChatOpenAI):
    """在库丢掉思考过程之前把它捡回 `additional_kwargs`。

    ⚠ 捡回的是**这一块的增量**而不是全文：`additional_kwargs` 的合并规约对
    字符串是拼接，所以攒完的那条消息上它自然是全文。改成每块写全文的话，
    攒出来的是同一段话重复几百遍。
    """

    def _convert_chunk_to_generation_chunk(
        self,
        chunk: dict[Any, Any],
        default_chunk_class: type[Any],
        base_generation_info: dict[Any, Any] | None,
    ) -> ChatGenerationChunk | None:
        """照原样转换，再把思考过程那一格挂回去。

        Args: chunk, default_chunk_class, base_generation_info。
        """
        generated = super()._convert_chunk_to_generation_chunk(  # type: ignore[reportUnknownMemberType]  # 理由：见文件头，这是库的私有接缝
            chunk, default_chunk_class, base_generation_info
        )
        if generated is None:
            return None
        thought = _thought_of(chunk)
        if thought:
            generated.message.additional_kwargs[REASONING_KEY] = thought
        return generated


def _thought_of(chunk: dict[Any, Any]) -> str:
    """从一块原始 delta 里取思考过程；没有就是空串。

    ⚠ 只防 `choices` 缺席或为空这一种：流的第一块与最后一块可能只带用量，
    而链式下标会在那里抛 `KeyError`，把整条流掐断在中途。再往里的形状**不用
    自己防**——`super()` 已经按同一份载荷走过一遍了，真不对的话在那里就抛了，
    这里再判一遍只会多出几条谁也走不到的分支。

    Args: chunk。
    """
    choices = chunk.get("choices")
    if not isinstance(choices, list):
        return ""
    first = next(iter(cast("list[dict[str, Any]]", choices)), None)
    if first is None:
        return ""
    delta = cast("dict[str, object]", first.get("delta") or {})
    given = delta.get(REASONING_KEY)
    return given if isinstance(given, str) else ""
