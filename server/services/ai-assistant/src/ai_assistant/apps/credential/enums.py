"""本模块的闭合集合。

⚠ 一律用 CHECK 约束而不是原生 ENUM（database-standard §1）：原生 ENUM 加一档
要 `ALTER TYPE`，而那在事务里对并发写是排他的。

⚠ **凭据的键不是闭合集合**：一路订阅账号一份凭据，而供应商是目录里运行期配出来
的，键就是那一路的 id。闭合的只有「这是哪一种凭据」。
"""

# 凭据属于**哪一种**接入形态。⚠ 是闭合集合，与目录里的形态码不是一回事：
# 目录那边叫 `codex_oauth`，这里是本服务自己的凭据种类命名空间
PROVIDER_KINDS = ("codex",)
# 订阅账号那一路的凭据种类
PROVIDER_KIND_CODEX = "codex"

# 环境变量配出来的那一路订阅账号用哪个键。⚠ 与 `PROVIDER_KIND_CODEX` 同值
# 不是巧合：目录整个缺席时那一路的档位名就是它，而存量部署的登录行也是这一格，
# 于是升级之后不用重新登录
LEGACY_CODEX_REF = PROVIDER_KIND_CODEX

# 认证方式。眼下只有订阅账号一档；API Key 那一路不落库，它在配置里
AUTH_MODES = ("chatgpt",)


def sql_values(values: tuple[str, ...]) -> str:
    """把闭合集合摊成 CHECK 约束里的值列表。

    ⚠ 与 `apps/chat/enums.py` 里那份同源却各写一份：跨功能模块只许走对方的
    services 公开面，而这是个纯格式化小工具，为它开一条公开面不值当。

    Args: values。
    """
    return ", ".join(f"'{value}'" for value in values)
