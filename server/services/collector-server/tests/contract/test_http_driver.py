"""HTTP 与已有驱动共用接口、快照及归档四元组，并分别装配网络策略。"""

import asyncio

from collector_server.apps.collect.drivers.base import (
    DriverConnection,
    RequestLimiter,
)
from collector_server.apps.collect.drivers.http.driver import HttpDriver
from collector_server.apps.collect.drivers.registry import create_driver
from collector_server.apps.collect.plan.adapt import specs_of
from collector_server.apps.collect.runtime.sink import encode_fields
from collector_server.container import _connection_of
from collector_server.settings import Settings
from collectwire import PlanPoint, PlanSource
from timeseries import split_value


def test_registered_http_driver_has_only_poll_read_capabilities() -> None:
    driver = create_driver(
        "http", DriverConnection(endpoint="http://127.0.0.1:18080/data")
    )
    assert isinstance(driver, HttpDriver)
    assert driver.capabilities.is_subscribe_supported is False
    assert driver.capabilities.is_browse_supported is False
    assert driver.capabilities.is_write_supported is False
    assert driver.capabilities.minimum_poll_interval_ms == 1000
    assert driver.capabilities.is_empty_source_connection_supported is False


def _source() -> PlanSource:
    return PlanSource(
        source_id="0192f000-0000-7000-8000-000000000001",
        code="http-test",
        protocol="http",
        endpoint="http://127.0.0.1:18080/data",
        options={"auth_type": "bearer"},
        password="test-secret",
        read_mode="poll",
        points=(
            PlanPoint(
                point_code="temperature",
                address="/data/temperature",
                data_type="float",
                sampling_interval_ms=1000,
                deadband=0.5,
                archive_enabled=True,
                archive_max_interval_ms=60_000,
            ),
        ),
    )


def test_http_plan_preserves_point_identity_type_and_archive_settings() -> None:
    source = _source()
    roundtrip = PlanSource.model_validate_json(source.model_dump_json())
    assert roundtrip == source
    assert specs_of(roundtrip)[0].address == "/data/temperature"
    assert specs_of(roundtrip)[0].data_type == "float"
    assert roundtrip.points[0].archive_max_interval_ms == 60_000
    assert roundtrip.points[0].deadband == 0.5
    assert "test-secret" not in repr(roundtrip)


def test_http_reading_has_the_existing_snapshot_and_archive_encoding() -> None:
    assert encode_fields({"temperature": (21.5, 1787544300000, "good")}) == {
        "temperature": '{"value":21.5,"ts_ms":1787544300000,"quality":"good"}'
    }
    assert split_value(True) == (1.0, None)
    assert split_value("运行") == (None, '"运行"')


def test_http_and_plc_connections_have_independent_network_policies(
    settings: Settings,
) -> None:
    configured = settings.model_copy(
        update={
            "http_read_enabled": True,
            "http_allowed_endpoints": (
                " http://127.0.0.1:18080 , http://127.0.0.1:18081 "
            ),
            "plc_read_enabled": False,
            "plc_allowed_endpoints": "127.0.0.1:502",
        }
    )
    http_limiter = asyncio.Semaphore(2)
    plc_limiter = asyncio.Semaphore(1)
    limiters: dict[str, RequestLimiter] = {
        "http": http_limiter,
        "plc": plc_limiter,
    }
    http = _connection_of(_source(), configured, limiters)
    plc = _connection_of(
        _source().model_copy(
            update={
                "protocol": "modbus_tcp",
                "endpoint": "modbus.tcp://127.0.0.1:502",
            }
        ),
        configured,
        limiters,
    )
    assert http.is_network_access_enabled is True
    assert http.allowed_endpoints == frozenset(
        {"http://127.0.0.1:18080", "http://127.0.0.1:18081"}
    )
    assert http.request_limiter is http_limiter
    assert plc.is_network_access_enabled is False
    assert plc.allowed_endpoints == frozenset({"127.0.0.1:502"})
    assert plc.request_limiter is plc_limiter


def test_empty_http_policy_cannot_reuse_plc_authorization(
    settings: Settings,
) -> None:
    limiters: dict[str, RequestLimiter] = {
        "http": asyncio.Semaphore(1),
        "plc": asyncio.Semaphore(1),
    }
    source = _connection_of(_source(), settings, limiters)
    assert source.is_network_access_enabled is False
    assert source.allowed_endpoints == frozenset()
