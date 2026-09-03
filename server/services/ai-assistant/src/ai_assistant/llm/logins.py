"""要登录的那几路此刻登没登录——问 platform 的内部凭据面（ADR-0041）。

⚠ 本服务**只领不刷、更不存**：登录态归 platform，与那一路供应商同属主。这一层
只把「领得到令牌吗」翻译成能力面要的那一格。

⚠ 领不到分两档，降级方向不同（runtime-resilience §9）：
- 「还没登录 / 登录已失效」→ 如实报未连接，界面据此指向模型管理页；
- 「平台此刻不可达」→ **仍报已连接**。报未连接的话，平台抖一下会让界面说
  「去登录一次」，而那一次登录同样打不通平台；报已连接则让这一轮如实失败在
  「模型暂时不可用」上，与真实原因一致。
"""

from dataclasses import dataclass

from lib.logging import get_logger
from llmcore import (
    CodexTokenClient,
    CredentialNotConnected,
    CredentialUnavailable,
)

_logger = get_logger("assistant.llm.logins")


@dataclass(frozen=True)
class LoginState:
    """能力面要的那一格。⚠ 令牌一个字都不在里面。"""

    is_connected: bool


@dataclass(frozen=True)
class PlatformLogins:
    """经 platform 内部面问登录态。"""

    tokens: CodexTokenClient

    async def status(self, provider: str) -> LoginState:
        """这一路登没登录。

        Args: provider（那一路供应商的 id）。
        """
        try:
            await self.tokens.usable(provider)
        except CredentialNotConnected:
            return LoginState(is_connected=False)
        except CredentialUnavailable:
            _logger.warning(
                "llm_login_probe_unavailable",
                "登录态问不到，按上一次的样子报",
                provider=provider,
            )
            return LoginState(is_connected=True)
        return LoginState(is_connected=True)
