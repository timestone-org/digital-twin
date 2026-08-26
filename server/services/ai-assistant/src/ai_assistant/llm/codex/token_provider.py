"""把库里那份凭据做成上游要的令牌提供者。

⚠ 上游默认那个提供者把令牌存在 `~/.langchain/chatgpt-auth.json` 里，靠文件锁
串行刷新。放在服务器上不成立：多副本各有各的文件系统，而凭据是整套部署共用的
一份。所以只借它的**协议**，存取换成我们自己那张表。

⚠ 只实现异步两个方法。同步那两个明确抛——本服务的模型调用一律走 `astream` /
`ainvoke`，而在异步进程里跑一次同步刷新意味着**阻塞整个事件循环**去等一次网络
往返（code-style-python §5：async 里禁任何阻塞调用）。留成「悄悄能用」的话，
将来某条同步路径会把整个副本卡住，而现象只是「助手偶尔很慢」。
"""

import datetime as dt
from typing import Protocol

from langchain_openai import chatgpt_oauth as oauth

# 上游那个私有的令牌形状。⚠ **只在这一行接触它**：上游改名时红的是这一处，
# 而不是散在各个签名里的四五处
CodexToken = (
    oauth._ChatGPTToken  # noqa: SLF001  # pyright: ignore[reportPrivateUsage]
)

# 一个提供者只服务一路模型
CODEX_PROVIDER = "codex"

# 交给上游的占位。⚠ 续期在我们这一层做，它拿到的这一格永远不会被用到
_REFRESH_PLACEHOLDER = "managed-by-server"

_SYNC_REFUSED = (
    "订阅账号那一路只支持异步取令牌：同步路径会阻塞事件循环去等一次网络往返"
)


class UsableToken(Protocol):
    """此刻能用的那一份：访问令牌 + 账号标识。"""

    @property
    def access_token(self) -> str: ...

    @property
    def account_id(self) -> str | None: ...


class TokenSource(Protocol):
    """从哪儿拿一份此刻能用的令牌。"""

    async def usable(self, provider: str) -> UsableToken: ...


class StoredTokenProvider:
    """满足上游 `_ChatGPTOAuthTokenProvider` 协议的落库版提供者。"""

    def __init__(self, source: TokenSource) -> None:
        """Args: source（凭据读写面，必要时会就地续期）。"""
        self._source = source

    async def aget_access_token(self) -> str:
        """取一个此刻能用的访问令牌。"""
        return (await self._source.usable(CODEX_PROVIDER)).access_token

    async def aget_token(self) -> CodexToken:
        """取整份令牌包。

        ⚠ 上游从这里读的是 `access_token` 与 `account_id`（后者进请求头，
        少了它后端认不出是哪个订阅）。**refresh_token 不交出去**——它一个字都
        不该离开凭据那一层，这里放一个占位。
        """
        token = await self._source.usable(CODEX_PROVIDER)
        return CodexToken(
            access_token=token.access_token,
            # 协议要求非空；续期由我们自己做，上游永远用不到这一格
            refresh_token=_REFRESH_PLACEHOLDER,
            expires_at=dt.datetime.now(dt.UTC) + dt.timedelta(minutes=1),
            account_id=token.account_id,
        )

    def get_access_token(self) -> str:
        """同步路径不支持，见文件头。"""
        raise NotImplementedError(_SYNC_REFUSED)

    def get_token(self) -> CodexToken:
        """同步路径不支持，见文件头。"""
        raise NotImplementedError(_SYNC_REFUSED)
