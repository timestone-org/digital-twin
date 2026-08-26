"""本模块的闭合集合。

⚠ 一律用 CHECK 约束而不是原生 ENUM（database-standard §1）：原生 ENUM 加一档
要 `ALTER TYPE`，而那在事务里对并发写是排他的。
"""

# 凭据属于哪一路模型。⚠ 是闭合集合——将来接第二家时在这里加一档，
# 而不是让任意字符串入库：拼错的那一行永远不会被任何一路读到，
# 而界面上表现为「登录成功了但助手说没登录」
PROVIDERS = ("codex",)

# 认证方式。眼下只有订阅账号一档；API Key 那一路不落库，它在配置里
AUTH_MODES = ("chatgpt",)


def sql_values(values: tuple[str, ...]) -> str:
    """把闭合集合摊成 CHECK 约束里的值列表。

    ⚠ 与 `apps/chat/enums.py` 里那份同源却各写一份：跨功能模块只许走对方的
    services 公开面，而这是个纯格式化小工具，为它开一条公开面不值当。

    Args: values。
    """
    return ", ".join(f"'{value}'" for value in values)
