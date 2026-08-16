"""W3C Trace Context 的生成、解析与组装。

⚠ 队列与总线不会自动传播链路：消息信封里漏了 `traceparent`，链路就在异步处
齐断（docs/agents/observability.md §4.2）。传播口径只有这一份。
"""

import os
import re

from lib.logging.context import current_log_context

# W3C traceparent 的版本位与采样标志位
_VERSION = "00"
_SAMPLED = "01"
_TRACE_HEX = 32
_SPAN_HEX = 16

_TRACEPARENT_RE = re.compile(
    rf"^{_VERSION}-(?P<trace>[0-9a-f]{{{_TRACE_HEX}}})"
    rf"-(?P<span>[0-9a-f]{{{_SPAN_HEX}}})-[0-9a-f]{{2}}$"
)


def new_trace_id() -> str:
    """生成 32 位十六进制 trace id。"""
    return os.urandom(_TRACE_HEX // 2).hex()


def new_span_id() -> str:
    """生成 16 位十六进制 span id。"""
    return os.urandom(_SPAN_HEX // 2).hex()


def parse_traceparent(raw: str | None) -> str | None:
    """从 `traceparent` 取 trace id；格式不合法返回 None。

    Args: raw。
    """
    if not raw:
        return None
    matched = _TRACEPARENT_RE.match(raw.strip().lower())
    return matched.group("trace") if matched else None


def compose_traceparent(trace_id: str | None, span_id: str | None) -> str:
    """把一对 id 压成一条 W3C traceparent。缺的那一段现生成。

    ⚠ 必须规整成定长十六进制：上游给的 id 可能带横杠或长度不对，原样拼出去
    是一条**格式不合法的** traceparent，而收方只会静默丢弃它——现象是链路断了
    却没有任何报错。
    ⚠ 缺 id 时补随机值而不是补零：全零 trace id 按 W3C 规范无效，同样会被丢弃。
    Args: trace_id, span_id。
    """
    trace = _normalized(trace_id, _TRACE_HEX) or new_trace_id()
    span = _normalized(span_id, _SPAN_HEX) or new_span_id()
    return f"{_VERSION}-{trace}-{span}-{_SAMPLED}"


def current_traceparent() -> str:
    """把当前日志上下文压成一条 traceparent；没有上下文就现开一条链路。

    ⚠ contextvars 不跨任务传播：后台循环要在每一拍开头绑一次上下文再调它，
    否则每一拍都是一条互不相干的新链路，接不回发起它的那次请求。
    """
    context = current_log_context()
    return compose_traceparent(context.trace_id, context.span_id)


def _normalized(raw: str | None, width: int) -> str | None:
    """去横杠、转小写、右对齐补零到定长；不是十六进制就当没给。

    Args: raw, width。
    """
    if not raw:
        return None
    cleaned = raw.replace("-", "").lower()[:width]
    if not cleaned or any(char not in "0123456789abcdef" for char in cleaned):
        return None
    return cleaned.rjust(width, "0")
