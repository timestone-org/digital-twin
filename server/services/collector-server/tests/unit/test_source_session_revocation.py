"""守会话撤销后晚到的连接失败不再覆盖运行态。"""

import asyncio
from typing import Any

from collectwire import STATE_CONNECTING
from unit.test_runtime_session import _session


async def test_revoked_session_does_not_report_a_late_driver_error(
    build_source: Any, build_driver: Any, reporter: Any
) -> None:
    driver = build_driver(connect_error=TimeoutError("现场连接晚超时"))
    driver.connect_gate = asyncio.Event()
    session = _session(build_source(), driver, reporter)
    running = asyncio.create_task(session.run())
    try:
        await asyncio.wait_for(driver.has_entered_connect.wait(), timeout=1)
        session.revoke()
        driver.connect_gate.set()
        await asyncio.wait_for(running, timeout=1)
        assert reporter.states() == [STATE_CONNECTING]
    finally:
        driver.connect_gate.set()
        await session.stop()
