"""订阅账号那一路的令牌提供者。

守三条：账号标识要一路带到上游（少了它后端认不出是哪个订阅）；**同步那两格
一次 IO 都不做**——它们只回答异步刚取到的那一份快照（让它们抛的话每一次对话
都 500，让它们自己去取的话就是在事件循环里阻塞等一次往返）；以及**问的是
这一路自己的 id**——写死一个名字的话，目录里配出来的那几路第二次取令牌时会去
要一个根本不存在的键。
"""

from dataclasses import dataclass

import pytest

from llmcore.codex.tokens import StoredTokenProvider


@dataclass(frozen=True)
class _Token:
    access_token: str = "at-1"
    account_id: str | None = "acc-1"


class _Source:
    def __init__(self, token: _Token | None = None) -> None:
        self.asked: list[str] = []
        self._token = token or _Token()

    async def usable(self, provider: str) -> _Token:
        self.asked.append(provider)
        return self._token


async def test_the_access_token_comes_from_the_source() -> None:
    provider = StoredTokenProvider(_Source(), "p1")
    assert await provider.aget_access_token() == "at-1"


async def test_the_account_id_rides_along() -> None:
    provider = StoredTokenProvider(_Source(), "p1")
    assert (await provider.aget_token()).account_id == "acc-1"


async def test_the_refresh_token_never_leaves_the_owner() -> None:
    # 交出去的那一格是占位：续期在属主那一侧做，上游永远用不到它
    token = await StoredTokenProvider(_Source(), "p1").aget_token()
    assert token.refresh_token != "at-1"


async def test_it_asks_for_the_provider_it_was_built_for() -> None:
    """⚠ 目录里配出来的那几路 id 是 uuid，不是形态名。写死一个名字的话，
    装配那一下是对的（种子令牌来自正确的 id），第二次取令牌却去要一个不存在
    的键——现象是「说了两句就掉登录」，而库里那一行好端端躺着。"""
    source = _Source()
    provider = StoredTokenProvider(source, "8f0c1e3a-uuid-like")
    await provider.aget_access_token()
    assert source.asked == ["8f0c1e3a-uuid-like"]


async def test_the_sync_path_answers_from_the_snapshot_without_going_out(
    # 上游把 api_key 焊成同步可调用件：异步请求也会从执行器线程回来调这一格。
    # 抛的话每一次对话都 500，自己去取的话就是在事件循环里阻塞等一次往返
) -> None:
    source = _Source()
    provider = StoredTokenProvider(source, "p1")
    await provider.aget_token()
    assert provider.get_access_token() == "at-1"
    assert provider.get_token().account_id == "acc-1"
    # 一次都没再出去：同步这一格只回答快照
    assert len(source.asked) == 1


async def test_the_snapshot_follows_the_latest_async_fetch() -> None:
    # 续期换了一份新的之后，同步那一格不许还捧着旧的
    source = _Source()
    provider = StoredTokenProvider(
        source, "p1", seed=_Token(access_token="at-0")
    )
    assert provider.get_access_token() == "at-0"
    await provider.aget_access_token()
    assert provider.get_access_token() == "at-1"


def test_a_seeded_provider_answers_before_any_async_call() -> None:
    # 装配时刚领过一次令牌，那一份直接当快照——第一次请求不该撞空
    provider = StoredTokenProvider(_Source(), "p1", seed=_Token())
    assert provider.get_access_token() == "at-1"


def test_an_unseeded_sync_call_refuses_instead_of_blocking_the_loop() -> None:
    # 走到这儿说明调用次序变了。悄悄去取一次的话，阻塞的是整个副本
    provider = StoredTokenProvider(_Source(), "p1")
    with pytest.raises(RuntimeError):
        provider.get_access_token()
    with pytest.raises(RuntimeError):
        provider.get_token()
