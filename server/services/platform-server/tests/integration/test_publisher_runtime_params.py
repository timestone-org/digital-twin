"""运行参数页「大屏」那一组要真的进到发布循环里。

⚠ 页面标着「即时生效」：保存成功而循环照用环境变量，就是「配了不生效」。
"""

import httpx
import pytest
from unit.database_fakes import MakerSessions

from platform_server.publish_knobs import PublishKnobs, read_knobs
from platform_server.settings import API_PREFIX, Settings

pytestmark = pytest.mark.requires_postgres

DASHBOARD_SECTION_URL = f"{API_PREFIX}/runtime-params/dashboard"


async def test_without_overrides_the_loop_runs_on_env_values(
    worker_sessions: MakerSessions, settings: Settings
) -> None:
    knobs = await read_knobs(worker_sessions, settings)
    assert knobs == PublishKnobs(
        window_s=settings.publish_window_ms / 1000,
        reconcile_interval_s=settings.publish_reconcile_interval_s,
        max_items=settings.publish_max_items,
    )


async def test_a_saved_override_is_what_the_loop_reads(
    app_client: httpx.AsyncClient,
    worker_sessions: MakerSessions,
    settings: Settings,
) -> None:
    written = await app_client.put(
        DASHBOARD_SECTION_URL,
        json={
            "values": {
                "publish_window_ms": 500,
                "publish_max_items": 10,
                "publish_reconcile_interval_s": 7,
            }
        },
    )
    assert written.status_code == 200, written.text
    knobs = await read_knobs(worker_sessions, settings)
    assert knobs == PublishKnobs(
        window_s=0.5, reconcile_interval_s=7.0, max_items=10
    )
