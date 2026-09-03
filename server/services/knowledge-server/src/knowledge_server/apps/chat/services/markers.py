"""引用角标：给模型一个短标记，让「用到了哪几段」变成一个事实。

⚠ 没有角标就没有引用。检索回执里那十来条，模型多半只用了两三条——把查到的
全列出来，等于让用户自己从一堆里找哪几条支撑了那句话，而那正是「依据看着很多
却没用」的来路。

⚠ 用圆圈数字而不是 `[3]`：正文里本来就会出现方括号加数字（标准号、数组下标），
而 `①` 这类字符在中文技术文档的正文里几乎不出现。代价是超过 50 之后没有字符
可用——那时退回 `(51)` 这种形态，而一回合里引到 50 段以上不现实。
"""

import re

# 三段连续的码位凑出 1–50。⚠ 分三段是 Unicode 自己的排布，不是我们挑的：
# ①–⑳ 之后并不接着 ㉑
_RUNS = ((1, 20, 0x2460), (21, 35, 0x3251), (36, 50, 0x32B1))

#: 有字符可用的上限。超了退回 `(51)` 这种形态
MAX_CIRCLED = 50

# 扫答案时认的两种形态。⚠ 两种都要认：模型偶尔会把圆圈数字写成 `(3)`，
# 只认一种的话那一次的引用整个丢掉，而答案看着完全正常
_CIRCLED = "".join(
    chr(base + at) for low, high, base in _RUNS for at in range(high - low + 1)
)
_PATTERN = re.compile(rf"[{_CIRCLED}]|\((\d{{1,3}})\)")


def marker_of(number: int) -> str:
    """第 n 条召回的角标，n 从 1 起。

    Args: number。
    """
    for low, high, base in _RUNS:
        if low <= number <= high:
            return chr(base + number - low)
    return f"({number})"


def numbers_in(text: str) -> list[int]:
    """答案里出现过哪几个角标，按出现序去重。

    ⚠ 去重但**保序**：引用面按「第一次被引到」的顺序摆，那与读的人扫过去的
    顺序一致。

    Args: text。
    """
    seen: list[int] = []
    for found in _PATTERN.finditer(text):
        number = (
            int(found.group(1))
            if found.group(1)
            else _number_of(found.group(0))
        )
        if number and number not in seen:
            seen.append(number)
    return seen


def _number_of(one: str) -> int:
    """一个圆圈数字是第几；不是圆圈数字给 0。

    Args: one。
    """
    point = ord(one)
    for low, _high, base in _RUNS:
        at = point - base
        if 0 <= at < _RUNS[[r[2] for r in _RUNS].index(base)][1] - low + 1:
            return low + at
    return 0
