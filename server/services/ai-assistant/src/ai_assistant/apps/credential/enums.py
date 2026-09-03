"""本模块的闭合集合。⚠ 只服务于那张仍在库里的表，没有任何读写路径用它。

⚠ 一律用 CHECK 约束而不是原生 ENUM（database-standard §1）：原生 ENUM 加一档
要 `ALTER TYPE`，而那在事务里对并发写是排他的。
"""

# 凭据属于**哪一种**接入形态
PROVIDER_KINDS = ("codex",)
# 认证方式
AUTH_MODES = ("chatgpt",)


def sql_values(values: tuple[str, ...]) -> str:
    """把闭合集合摊成 CHECK 约束里的值列表。

    Args: values。
    """
    return ", ".join(f"'{value}'" for value in values)
