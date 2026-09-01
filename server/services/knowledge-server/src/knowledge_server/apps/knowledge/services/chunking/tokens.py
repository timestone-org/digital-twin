"""粗估 token 数。

⚠ 刻意**不引分词器**：装一个精确分词器要几十兆模型文件，而这个数只用来控批
与显示——控批那一侧本来就要留余量，显示那一侧差一成没人看得出来。真要精确的
那天，换掉这一个函数即可。

⚠ 中英分开数：一个汉字约合一个 token，而英文约四个字符一个 token。混着按
字符数除以四的话，中文文档会被低估四倍——而低估的表现是一次嵌入请求超限失败，
且失败的是整批不是那一段。
"""

# 英文按几个字符折一个 token
_LATIN_PER_TOKEN = 4
# 汉字区间的两端
_CJK_FIRST = "一"
_CJK_LAST = "鿿"


def estimated(text: str) -> int:
    """粗估这段文本的 token 数。

    Args: text。
    """
    cjk = sum(1 for one in text if _CJK_FIRST <= one <= _CJK_LAST)
    rest = len(text) - cjk
    return cjk + (rest + _LATIN_PER_TOKEN - 1) // _LATIN_PER_TOKEN
