"""把一段过长的文本在句读处断成几片，每片都装得进嵌入窗口。

⚠ 这一步是**必须的**，不是锦上添花：一个段落本身就比窗口长时，「只在块边界
上下刀」这条规矩切不动它——切出来仍是一块超窗的，而超出的那一截被嵌入端点
静默丢掉。现场的 docx 里一段两千字并不罕见。

⚠ 优先在句读之后断，实在找不到才硬切。定长切出来的块有一半从半句话开始，
而那半句话在向量空间里几乎没有区分度——表现是「这一段明明有，就是搜不到」。

⚠ 「多少字符折多少 token」**不能按整段算一个平均值再乘**：`estimated()` 对
非汉字那一半是**向上取整**的，整段算一次的进位只发生一次，而切成 N 片之后
每片各进一次位——于是按平均比例切出来的片会稳定地比预算大一成。这里改成
二分出「从头取多少字符还装得下」，一次不多不少。
"""

from knowledge_server.apps.knowledge.services.chunking.tokens import estimated

# 断句的收尾记号。⚠ 中英两套都要有：现场资料里两种标点混着用，
# 只认中文的那一套会让整段英文说明退化成硬切
_STOPS = "\n。！？；…!?;"
# 退而求其次的断点：逗号一类。⚠ 分成两档而不是一锅：在句号处断出来的片
# 是完整句子，在逗号处断出来的不是，能不用就不用
_WEAK_STOPS = "，、,:："
# 一片至少要用掉窗口的几成才认这个断点。⚠ 没有这条下限的话，开头第一个句号
# 就会被采纳，于是切出一堆几十字的碎片——那正是要防的过度切分
_MIN_FILL = 0.6


def fitting_chars(text: str, max_tokens: int) -> int:
    """从这段文本的开头取多少个字符，还装得进 `max_tokens`。

    ⚠ 二分而不是按比例乘：理由见模块头。回的至少是 1，
    否则调用方的循环会原地打转。

    Args: text, max_tokens。
    """
    if estimated(text) <= max_tokens:
        return len(text)
    low, high = 1, len(text)
    while low < high:
        middle = (low + high + 1) // 2
        if estimated(text[:middle]) <= max_tokens:
            low = middle
        else:
            high = middle - 1
    return low


def _cut_at(piece: str, marks: str, floor: int) -> int:
    """这一片里最后一个落在 `floor` 之后的记号，切在它后面；没有给 0。

    Args: piece, marks, floor。
    """
    for at in range(len(piece) - 1, floor - 1, -1):
        if piece[at] in marks:
            return at + 1
    return 0


def sized_pieces(text: str, max_tokens: int) -> list[str]:
    """把一段文本切成每片都不超过上限的几片，尽量在句读处下刀。

    Args: text, max_tokens。
    """
    made: list[str] = []
    rest = text
    while estimated(rest) > max_tokens:
        span = fitting_chars(rest, max_tokens)
        head = rest[:span]
        floor = int(span * _MIN_FILL)
        at = _cut_at(head, _STOPS, floor) or _cut_at(head, _WEAK_STOPS, floor)
        # ⚠ 一个句读都找不到就整片硬切（表格粘成的一行、没有标点的长串编号）。
        # 硬切的片会从半句开始，但那强过整片被端点悄悄丢掉
        made.append(head[: at or span])
        rest = rest[at or span :]
    made.append(rest)
    return [one for one in made if one.strip()]
