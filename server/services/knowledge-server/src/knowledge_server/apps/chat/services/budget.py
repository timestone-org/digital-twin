"""小上下文的模型上，一次工具产出能占多少字。

⚠ 有这一层是因为**窗口小的模型会在同一步稳定失败**：现场那台本地 llama.cpp
只开了 `n_ctx=6656`，而一次 `kb.search` 回执就有五千多 token——检索一跑完，
下一次调用必然超窗，端点回 400，而给用户的是一句「模型端点认为请求不合法」，
与长度毫无关系。

⚠ 折算是**显式的近似**，不是精确记账：真正精确要按端点的分词器算，而那要么
多打一次网络、要么把分词器抄进来。近似的代价是留出的余量偏保守（少喂几百字），
而算不准的代价是回合直接失败——两者不对称，所以宁可保守。

⚠ 窗口不知道时**一格都不改**（回缺省），不去猜一个小值：猜小了的表现是大窗口
的模型也只拿得到半份资料，而那与「资料里确实只有这些」分辨不出来。
"""

# 留给「常驻提示词 + 工具声明 + 历史 + 这一轮答复」的那一份。⚠ 实测这套部署
# 的固定前缀就将近 2000 token（`model_call_usage` 的 `cached`），再加历史与
# 答复，3000 是能把一个两三轮的会话跑完的下限
RESERVED_TOKENS = 3000
# 字符/token 比。⚠ 实测这台端点上一次检索回执约 7200 字折 5600 token，
# 即 1.29；取 1.2 是**往少了取**——取大了会让预算算得比真实窗口宽
CHARS_PER_TOKEN = 1.2
# 再小也要留这么多字。⚠ 低于这个数的回执对模型没有意义，与其喂半句话
# 不如让它按「资料不足」回答
MIN_RESULT_CHARS = 600
# 历史再少也要留这么多字。⚠ 削成 0 的表现是「它连我上一句问的什么都不记得」，
# 而那比少看几条资料更让人没法用
MIN_HISTORY_CHARS = 800
# 留给这一轮答复的那一份。⚠ 模型写答案的 token 与提示词共用同一个窗口：
# 不留的表现是「提示词刚好塞进去，写到一半被截断」
ANSWER_TOKENS = 800


def result_chars(context_tokens: int, ceiling: int) -> int:
    """这一档模型上，一次工具产出最多占多少字。

    ⚠ 窗口给 0（不知道）时原样回 `ceiling`：这一层只在**知道窗口**时才收紧。

    Args: context_tokens（对话档模型的窗口，0 = 不知道）,
        ceiling（原本的上限）。
    """
    if context_tokens <= 0:
        return ceiling
    afforded = int((context_tokens - RESERVED_TOKENS) * CHARS_PER_TOKEN)
    return max(MIN_RESULT_CHARS, min(ceiling, afforded))


def snippet_chars(budget: int, limit: int, ceiling: int) -> int:
    """一条召回的正文最多多少字。

    ⚠ 按**这一次要回几条**摊，而不是按上限摊：模型只要 2 条时该让它看得更全，
    而不是拿着按 20 条算出来的那点字数把两条都截断。

    Args: budget（这一次工具产出的总预算）, limit（这一次回几条）, ceiling。
    """
    if budget <= 0 or limit <= 0:
        return ceiling
    # 留一成给回执里的元数据（文件名、页码、角标、说明那几句）
    return max(1, min(ceiling, int(budget * 0.9) // limit))


def history_chars(context_tokens: int, result_budget: int) -> int:
    """回放进来的历史最多占多少字。

    ⚠ 历史与「这一轮的工具产出」抢的是同一个窗口。**先保这一轮**：历史丢几轮
    只是模型忘了前面聊过什么，而工具产出被挤掉是这一问直接答不出来。

    ⚠ 给 0（不知道窗口）时回 0，即不限——由条数窗口那一份说了算。

    Args: context_tokens（0 = 不知道）, result_budget（这一轮工具产出的预算）。
    """
    if context_tokens <= 0:
        return 0
    afforded = int(
        (context_tokens - RESERVED_TOKENS) * CHARS_PER_TOKEN - result_budget
    )
    return max(MIN_HISTORY_CHARS, afforded)


def context_chars(context_tokens: int) -> int:
    """整段上下文（含常驻提示词与工具声明）最多占多少字。

    ⚠ 这是给回合循环用的**总闸**：一个回合里连查三次是常事，而每一次都在单次
    上限之内——顶穿窗口的是它们加起来。

    ⚠ 折算里要把答复那一份也留出来：模型写答案的 token 与提示词共用同一个窗口。

    Args: context_tokens（0 = 不知道）。
    """
    if context_tokens <= 0:
        return 0
    return max(
        MIN_RESULT_CHARS,
        int((context_tokens - ANSWER_TOKENS) * CHARS_PER_TOKEN),
    )
