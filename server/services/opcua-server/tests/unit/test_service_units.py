"""不依赖真库与真服务器的那部分：配置校验、幂等占坑、自检、服务密钥。"""

import logging
import uuid
from types import SimpleNamespace
from typing import Any, cast

import pytest
from pydantic import BaseModel, SecretStr, ValidationError

from lib.errors import Conflict, Unauthenticated
from lib.testing import InMemoryCache
from opcua_server.apps.instance.deps import require_service_key
from opcua_server.apps.instance.errors import NodeNotFound
from opcua_server.apps.instance.services.idempotency import IdempotencyStore
from opcua_server.apps.instance.services.node_service import (
    NodeRuntimeSync,
)
from opcua_server.apps.instance.services.presenter import (
    unwrap_value,
    wrap_value,
)
from opcua_server.container import Container
from opcua_server.settings import Settings

SECRET = SecretStr("x" * 32)


class _Payload(BaseModel):
    """幂等测试用的最小载荷。"""

    value: int


def _container() -> Container:
    """只带 settings 的最小容器替身。

    ⚠ `require_service_key` 只读 `settings.edge_service_key`；造一整个真容器
    要连库连缓存，那会把一条纯逻辑用例变成集成用例。
    """
    return cast(Container, SimpleNamespace(settings=_settings()))


def _settings(**overrides: object) -> Settings:
    base: dict[str, object] = {
        "postgres_host": "h",
        "postgres_user": "u",
        "postgres_password": SecretStr("p"),
        "postgres_db": "d",
        "redis_host": "r",
        "edge_signing_secret": SECRET,
        "edge_service_key": SECRET,
    }
    base.update(overrides)
    return Settings(**base)


def test_port_pool_must_be_a_range() -> None:
    """端口池格式不对时构造即失败，而不是运行到分配端口那一刻才炸。"""
    with pytest.raises(ValidationError):
        _settings(port_pool="4840")


def test_port_pool_bounds_must_be_integers() -> None:
    """池的两端必须是整数。"""
    with pytest.raises(ValidationError):
        _settings(port_pool="a-b")


def test_port_pool_must_be_ascending_and_in_range() -> None:
    """起点不能大于终点，也不能越出端口范围。"""
    with pytest.raises(ValidationError):
        _settings(port_pool="5000-4000")
    with pytest.raises(ValidationError):
        _settings(port_pool="0-100")


def test_pool_must_cover_max_instances() -> None:
    """池比实例上限小时启动就失败。

    ⚠ 这条守的是「配少了不会在启动时报错，而是建到第 N+1 个实例时才失败」
    ——那时现场已经在用了。
    """
    with pytest.raises(ValidationError):
        _settings(port_pool="4840-4841", max_instances=16)


def test_port_pool_expands_to_every_port() -> None:
    """池是闭区间，两端都算。"""
    assert _settings(port_pool="4840-4843", max_instances=4).ports() == (
        4840,
        4841,
        4842,
        4843,
    )


def test_value_wrapping_round_trips() -> None:
    """初值的封装与拆封互为逆运算，None 原样穿过。"""
    assert unwrap_value(wrap_value(20.5)) == 20.5
    assert wrap_value(None) is None
    assert unwrap_value(None) is None


async def test_idempotency_without_a_key_just_runs() -> None:
    """没给幂等键就照常执行——键是可选的。"""
    store = IdempotencyStore(cache=InMemoryCache())
    calls: list[int] = []

    async def action() -> _Payload:
        calls.append(1)
        return _Payload(value=len(calls))

    first = await store.run_once(
        endpoint="e",
        key=None,
        caller=uuid.uuid4(),
        model=_Payload,
        action=action,
    )
    second = await store.run_once(
        endpoint="e",
        key=None,
        caller=uuid.uuid4(),
        model=_Payload,
        action=action,
    )
    assert (first.value, second.value) == (1, 2)


async def test_concurrent_same_key_is_a_conflict() -> None:
    """同键请求还在处理中时冲突，而不是并发执行两次。"""
    store = IdempotencyStore(cache=InMemoryCache())
    caller = uuid.uuid4()
    await store.claim(endpoint="e", key="k", caller=caller)
    with pytest.raises(Conflict):
        await store.claim(endpoint="e", key="k", caller=caller)


async def test_failed_action_releases_the_claim() -> None:
    """失败后放开占位，同一个键可以重试。

    ⚠ 不放开的话，一次偶发失败会把这个键永久钉死，而调用方无从得知该等多久。
    """
    store = IdempotencyStore(cache=InMemoryCache())
    caller = uuid.uuid4()

    async def failing() -> _Payload:
        raise RuntimeError("下游抖了一下")

    with pytest.raises(RuntimeError):
        await store.run_once(
            endpoint="e",
            key="k",
            caller=caller,
            model=_Payload,
            action=failing,
        )
    # 放开了才能再占一次
    await store.claim(endpoint="e", key="k", caller=caller)


async def test_service_key_missing_is_rejected() -> None:
    """服务级密钥缺失一律拒绝，不是放行。"""
    with pytest.raises(Unauthenticated):
        await require_service_key(_container(), x_service_key=None)


async def test_service_key_mismatch_is_rejected() -> None:
    """服务级密钥不符时拒绝。"""
    with pytest.raises(Unauthenticated):
        await require_service_key(_container(), x_service_key="wrong")


async def test_service_key_match_passes() -> None:
    """密钥逐字相符才放行，且依赖返回 None（它只做校验，不产出身份）。"""
    assert (
        await require_service_key(_container(), x_service_key="x" * 32) is None
    )


class _BrokenDatabase:
    """会话一开就炸的数据库假件，用来逼出补偿路径的失败分支。"""

    def session(self) -> object:
        raise RuntimeError("数据库不可达")


class _EmptySupervisor:
    """永远说「没有在跑的实例」。"""

    def find(self, _instance_id: object) -> None:
        return None


def _sync(supervisor: object) -> NodeRuntimeSync:
    """装一个数据库必炸的同步器。

    Args: supervisor。
    """
    return NodeRuntimeSync(
        database=cast(Any, _BrokenDatabase()),
        supervisor=cast(Any, supervisor),
    )


async def test_compensation_failure_is_logged_not_raised(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """⚠ 补偿自己失败也不能盖住原始异常——否则调用方看到的是错的原因。

    Args: caplog。
    """
    with caplog.at_level(logging.ERROR):
        await _sync(_EmptySupervisor()).discard(uuid.uuid4())
    assert "opcua_node_compensation_failed" in caplog.text


async def test_deactivate_tolerates_a_node_absent_from_the_runtime(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """运行时说它不在就按已删除继续，否则这一行永远删不掉。

    ⚠ 但不一致本身要留痕：静默跳过会让两侧长期对不上而没人知道。

    Args: caplog。
    """

    class _Running:
        async def remove_node(self, _identifier: str) -> None:
            raise NodeNotFound("不在")

    class _Supervisor:
        def find(self, _instance_id: object) -> object:
            return _Running()

    with caplog.at_level(logging.WARNING):
        await _sync(_Supervisor()).deactivate(uuid.uuid4(), "ghost")
    assert "opcua_node_absent_in_runtime" in caplog.text
