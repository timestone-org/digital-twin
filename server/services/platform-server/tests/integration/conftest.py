"""集成层共用的夹具。

⚠ 「环境能力缺失」的跳过一律写在 conftest（`check_tests` 闸钉着）：散在用例里
就会变成好几份各自判一次可达性的口径，而其中一份判歪的表现是那一批用例整片跳过、
CI 照样绿。
"""

from collections.abc import AsyncIterator

import pytest
from conftest import AppContext
from unit.dataset_fakes import FakeSetSink

from integration.dataset_helpers import ArchiveWriter
from lib.utils.ids import uuid7
from platform_server.apps.dataset.services.dirty import DatasetDirtyLog
from platform_server.container import _build_history_database
from platform_server.settings import Settings


@pytest.fixture
async def archive(
    app_context: AppContext, settings: Settings
) -> AsyncIterator[ArchiveWriter]:
    """一个只属于本条用例的点位，用完把它的读数清干净。

    ⚠ 搭 `app_context` 的车而不是自己判可达性：连不上库时那个夹具已经跳过了。
    ⚠ 复用生产归档连接的超时预算与 search_path，避免查询在测试里提前超时。
    Args: app_context, settings。
    """
    del app_context
    database = _build_history_database(settings)
    writer = ArchiveWriter(database=database, source_id=uuid7())
    yield writer
    await writer.clear()
    await database.dispose()


@pytest.fixture
def dirty() -> DatasetDirtyLog:
    """报脏口的进程内替身。"""
    return DatasetDirtyLog(sink=FakeSetSink())
