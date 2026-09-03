"""几种格式共用的结构小工具：标题栈与表头折行。

⚠ 收在一处而不是每个解析器各写一份：markdown、Word、工作簿都要「标题栈弹到
同级」与「表头拼进每一行」这两件事，各写一份的话它们会漂成几种规则，而漂开
的表现是同一份内容在不同格式下切出不同的块。
"""

# 一个单元格最多取多少字符。⚠ 有上限：一格里粘进整篇说明书是现场常事，
# 而它会把整块挤成一格的内容
MAX_CELL_CHARS = 2_000


def pushed(
    stack: list[tuple[int, str]], level: int, text: str
) -> list[tuple[int, str]]:
    """把一个标题压进栈，先弹掉不比它浅的那几层。

    ⚠ 必须先弹：不弹的话「第 2 章」之后的「第 3 章」会挂在「第 2 章」下面，
    而那条路径会一路带进每一个块的引用里。

    Args: stack, level, text。
    """
    kept = [one for one in stack if one[0] < level]
    kept.append((level, text))
    return kept


def path_of(stack: list[tuple[int, str]]) -> tuple[str, ...]:
    """当前标题栈摊成一条路径。

    Args: stack。
    """
    return tuple(text for _level, text in stack)


def cell_text(value: object) -> str:
    """一个单元格的文本；空的给空串。

    Args: value。
    """
    if value is None:
        return ""
    return str(value).strip()[:MAX_CELL_CHARS]


def paired(header: list[str], cells: list[str]) -> str:
    """把表头与一行值拼成「列名=值」。

    ⚠ 表头要拼进**每一行**：只存 `12.5 | 开 | 3` 的话，检索到这一行也读不出
    它是什么——列名在表头那一行，而那一行是另一个块。

    ⚠ 多出来的列没有表头时用序号兜底，不丢：现场的表常有几列没写表头，
    丢掉的话那几列的数据就再也检索不到了。

    Args: header, cells。
    """
    parts: list[str] = []
    for index, value in enumerate(cells):
        if not value:
            continue
        name = header[index] if index < len(header) else ""
        parts.append(f"{name or f'第{index + 1}列'}={value}")
    return " | ".join(parts)
