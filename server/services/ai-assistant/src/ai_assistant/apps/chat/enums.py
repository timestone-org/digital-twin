"""本模块的闭合集合，以及把它们摊成 SQL 值列表的小工具。

⚠ 一律用 CHECK 约束而不是原生 ENUM（database-standard §1）：原生 ENUM 加一档
要 `ALTER TYPE`，而那在事务里对并发写是排他的。
"""

# 工作面：助手当前所处的页面。⚠ 是闭合集合——未登记的值一律 400。
# 放开成任意字符串的后果是拼错的工作面照常入库、永远匹配不到任何技能，
# 而界面上表现为「助手什么都不会」，与配错了字毫无关联
SURFACE_KINDS = (
    "dashboard-editor",
    "twin-editor",
    "dataset-table",
    "collect-source",
    "dashboard-view",
)

# 消息的说话人。`tool` 是工具结果回填的那一条，模型要按它读上一步的输出
MESSAGE_ROLES = ("user", "assistant", "tool")

# 步骤的种类。⚠ 客户端工具与服务端工具分两档而不是合成「工具」一档：
# 它们的失败含义完全不同——服务端工具失败是我们的问题，客户端工具失败
# 意味着那一页根本没实现它，得如实告诉模型别再调
STEP_KINDS = ("model", "server_tool", "client_tool")

# 步骤的状态。`awaiting_client` 是待续状态：模型已经要了客户端工具，
# 正等浏览器把结果送回来。⚠ 它必须落库而不是留在内存里——api 角色是无状态的，
# 下一次续跑可能落到另一个副本上
STEP_STATES = ("running", "awaiting_client", "succeeded", "failed", "aborted")


def sql_values(values: tuple[str, ...]) -> str:
    """把闭合集合摊成 CHECK 约束里的值列表。

    Args: values。
    """
    return ", ".join(f"'{value}'" for value in values)
