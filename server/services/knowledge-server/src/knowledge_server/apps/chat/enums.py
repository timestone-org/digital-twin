"""本模块的闭合集合，以及把它们摊成 SQL 值列表的小工具。

⚠ 一律用 CHECK 约束而不是原生 ENUM（database-standard §1）。
⚠ 三个集合与助手那边**逐字相同**：前端渲染步骤与消息的那套组件两边共用，
多一档少一档界面就画不出来。由契约测试钉住。
"""

# 消息的说话人。`tool` 是工具结果回填的那一条，模型要按它读上一步的输出
MESSAGE_ROLES = ("user", "assistant", "tool")

# 步骤的种类。⚠ 客户端工具与服务端工具分两档：它们的失败含义完全不同——
# 服务端工具失败是我们的问题，客户端工具失败意味着那一页根本没实现它
STEP_KINDS = ("model", "server_tool", "client_tool")

# 步骤的状态。`awaiting_client` 是待续状态：模型已经要了客户端工具（反问），
# 正等浏览器把用户选的那一项送回来。⚠ 它必须落库而不是留在内存里——api 角色
# 无状态，下一次续跑可能落到另一个副本上
STEP_STATES = ("running", "awaiting_client", "succeeded", "failed", "aborted")


def sql_values(values: tuple[str, ...]) -> str:
    """把闭合集合摊成 CHECK 约束里的值列表。

    Args: values。
    """
    return ", ".join(f"'{value}'" for value in values)
