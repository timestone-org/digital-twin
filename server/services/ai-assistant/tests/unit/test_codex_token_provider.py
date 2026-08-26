"""落库版的令牌提供者。

守两条：账号标识要一路带到上游（少了它后端认不出是哪个订阅），
以及**同步路径明确抛**——在异步进程里跑一次同步刷新会阻塞整个事件循环去等一次
网络往返，留成「悄悄能用」的话，将来某条同步路径会把整个副本卡住，
而现象只是「助手偶尔很慢」。
"""

from dataclasses import dataclass

import pytest

from ai_assistant.llm.codex.token_provider import StoredTokenProvider


@dataclass(frozen=True)
class _Token:
    access_token: str = "at-1"
    account_id: str | None = "acc-1"


class _Source:
    async def usable(self, provider: str) -> _Token:
        assert provider == "codex"
        return _Token()


async def test_the_access_token_comes_from_the_store() -> None:
    provider = StoredTokenProvider(_Source())
    assert await provider.aget_access_token() == "at-1"


async def test_the_account_id_rides_along() -> None:
    provider = StoredTokenProvider(_Source())
    assert (await provider.aget_token()).account_id == "acc-1"


async def test_the_refresh_token_never_leaves_our_layer() -> None:
    # 交出去的那一格是占位：续期在凭据那一层做，上游永远用不到它
    token = await StoredTokenProvider(_Source()).aget_token()
    assert token.refresh_token != "at-1"


def test_the_sync_paths_refuse_instead_of_blocking_the_loop() -> None:
    provider = StoredTokenProvider(_Source())
    with pytest.raises(NotImplementedError):
        provider.get_access_token()
    with pytest.raises(NotImplementedError):
        provider.get_token()
