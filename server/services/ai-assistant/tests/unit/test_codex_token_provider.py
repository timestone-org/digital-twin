"""落库版的令牌提供者。

守两条：账号标识要一路带到上游（少了它后端认不出是哪个订阅），
以及**同步那两格一次 IO 都不做**——它们只回答异步刚取到的那一份快照。
让它们抛的话每一次对话都 500（上游把 `api_key` 焊成同步可调用件，异步请求
也会从执行器线程回来调一次），让它们自己去取的话就是在事件循环里阻塞等一次
网络往返，而现象只是「助手偶尔很慢」。
"""

from dataclasses import dataclass

import pytest

from ai_assistant.llm.codex.token_provider import StoredTokenProvider


@dataclass(frozen=True)
class _Token:
    access_token: str = "at-1"
    account_id: str | None = "acc-1"


class _Source:
    def __init__(self, token: _Token | None = None) -> None:
        self.asked = 0
        self._token = token or _Token()

    async def usable(self, provider: str) -> _Token:
        assert provider == "codex"
        self.asked += 1
        return self._token


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


async def test_the_sync_path_answers_from_the_snapshot_without_going_out(
    # 上游把 api_key 焊成同步可调用件：异步请求也会从执行器线程回来调这一格。
    # 抛的话每一次对话都 500，自己去取的话就是在事件循环里阻塞等一次往返
) -> None:
    source = _Source()
    provider = StoredTokenProvider(source)
    await provider.aget_token()
    assert provider.get_access_token() == "at-1"
    assert provider.get_token().account_id == "acc-1"
    # 一次都没再出去：同步这一格只回答快照
    assert source.asked == 1


async def test_the_snapshot_follows_the_latest_async_fetch() -> None:
    # 续期换了一份新的之后，同步那一格不许还捧着旧的
    source = _Source()
    provider = StoredTokenProvider(source, seed=_Token(access_token="at-0"))
    assert provider.get_access_token() == "at-0"
    await provider.aget_access_token()
    assert provider.get_access_token() == "at-1"


def test_a_seeded_provider_answers_before_any_async_call() -> None:
    # 装配时刚摸过一次令牌，那一份直接当快照——第一次请求不该撞空
    provider = StoredTokenProvider(_Source(), seed=_Token())
    assert provider.get_access_token() == "at-1"


def test_an_unseeded_sync_call_refuses_instead_of_blocking_the_loop() -> None:
    # 走到这儿说明调用次序变了。悄悄去取一次的话，阻塞的是整个副本
    provider = StoredTokenProvider(_Source())
    with pytest.raises(RuntimeError):
        provider.get_access_token()
    with pytest.raises(RuntimeError):
        provider.get_token()
