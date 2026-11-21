"""命令总线的入队和应答共享一个总时限。"""

import asyncio

import pytest

from platform_server.apps.collect.services.command_transport import (
    RedisCommandTransport,
)


async def test_a_command_budget_can_expire_before_enqueue_returns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = RedisCommandTransport(url="redis://127.0.0.1:1", block_s=1)

    async def never_returns(_key: str, _value: str) -> int:
        await asyncio.Event().wait()
        raise AssertionError("入队不应在超时后完成")

    monkeypatch.setattr(transport._client, "lpush", never_returns)
    try:
        async with asyncio.timeout(0.5):
            assert (
                await transport.call(
                    {"action": "write"}, request_id="test-req", timeout_s=0.01
                )
                is None
            )
    finally:
        await transport.close()


async def test_wait_for_reply_uses_only_the_remaining_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    transport = RedisCommandTransport(url="redis://127.0.0.1:1", block_s=1)
    budgets: list[float] = []

    async def enqueue(_key: str, _value: str) -> int:
        await asyncio.sleep(0)
        return 1

    async def wait_reply(_keys: list[str], **options: float) -> None:
        budgets.append(options["timeout"])

    monkeypatch.setattr(transport._client, "lpush", enqueue)
    monkeypatch.setattr(transport._client, "blpop", wait_reply)
    try:
        assert (
            await transport.call(
                {"action": "write"}, request_id="test-req", timeout_s=10
            )
            is None
        )
        assert len(budgets) == 1
        assert 0 < budgets[0] < 10
    finally:
        await transport.close()
