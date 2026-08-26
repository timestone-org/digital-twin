"""把库里那份凭据做成上游要的令牌提供者。

⚠ 上游默认那个提供者把令牌存在 `~/.langchain/chatgpt-auth.json` 里，靠文件锁
串行刷新。放在服务器上不成立：多副本各有各的文件系统，而凭据是整套部署共用的
一份。所以只借它的**协议**，存取换成我们自己那张表。

⚠ 同步那两个方法**一次 IO 都不做**：它们只回答异步那一侧刚取到的那份快照。
两头都不能选——
- 让它们自己去取，就是在异步进程里阻塞整个事件循环等一次网络往返
  （code-style-python §5：async 里禁任何阻塞调用）；
- 让它们抛，则是**每一次对话都 500**：上游把 `api_key` 焊成
  `_SyncTokenCallable(provider)`，而 SDK 对同步可调用件的异步适配是丢进执行器
  线程再调一次同步 `get_access_token()`。于是登录是好的、装配是好的，只有说话
  那一下报错，而那条错指不回这里。

⚠ 快照不会旧：上游在 `_astream` / `_agenerate` 里**先 `await aget_token()`
才发请求**，同步这一格拿到的就是那同一份，中间隔着几毫秒。
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

# 同步那一格撞空时的说法。⚠ 走到这儿说明调用次序变了（上游本该先取一次异步的），
# 不是配置问题——悄悄去取一次的代价是阻塞整个副本
_NO_SNAPSHOT = (
    "订阅账号那一路还没取过令牌：同步路径只回答快照，不去等一次网络往返"
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

    def __init__(
        self, source: TokenSource, *, seed: UsableToken | None = None
    ) -> None:
        """Args: source（凭据读写面，必要时会就地续期）, seed（装配时刚摸到的
        那一份，直接当快照——第一次请求不该撞空）。
        """
        self._source = source
        self._snapshot = seed

    async def aget_access_token(self) -> str:
        """取一个此刻能用的访问令牌。"""
        return (await self._taken()).access_token

    async def aget_token(self) -> CodexToken:
        """取整份令牌包。

        ⚠ 上游从这里读的是 `access_token` 与 `account_id`（后者进请求头，
        少了它后端认不出是哪个订阅）。**refresh_token 不交出去**——它一个字都
        不该离开凭据那一层，这里放一个占位。
        """
        return _packed(await self._taken())

    def get_access_token(self) -> str:
        """同步路径只回答快照，见文件头。"""
        return self._snapshot_or_die().access_token

    def get_token(self) -> CodexToken:
        """同步路径只回答快照，见文件头。"""
        return _packed(self._snapshot_or_die())

    async def _taken(self) -> UsableToken:
        """去凭据面要一份此刻能用的，顺手更新快照。"""
        token = await self._source.usable(CODEX_PROVIDER)
        self._snapshot = token
        return token

    def _snapshot_or_die(self) -> UsableToken:
        """最近那一份。"""
        # ⚠ 这一格是从执行器线程读的：只读一个引用，不在这里做任何等待
        token = self._snapshot
        if token is None:
            raise RuntimeError(_NO_SNAPSHOT)
        return token


def _packed(token: UsableToken) -> CodexToken:
    """按上游的形状包一份。

    Args: token。
    """
    return CodexToken(
        access_token=token.access_token,
        # 协议要求非空；续期由我们自己做，上游永远用不到这一格
        refresh_token=_REFRESH_PLACEHOLDER,
        expires_at=dt.datetime.now(dt.UTC) + dt.timedelta(minutes=1),
        account_id=token.account_id,
    )
