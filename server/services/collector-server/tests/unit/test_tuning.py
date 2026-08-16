"""运行参数在采集侧的取值：覆盖值压过默认值，形状不对按没覆盖处理。

分组与键名是与 platform 参数目录的**复述契约**，这里把字面量钉死——两边任何
一侧改名，覆盖值都会静默失效（界面显示改成功了，采集器按旧值跑）。
"""

from typing import Any

from collector_server.apps.collect import tuning
from collector_server.apps.collect.archive.buffer import (
    ArchiveBuffer,
    ArchiveOptions,
)
from collector_server.apps.collect.runtime.sink import SnapshotSink
from collector_server.settings import Settings
from unit.test_runtime_sink import RecordingStore

TS_MS = 1_767_323_045_000


def test_the_section_and_key_literals_are_pinned() -> None:
    # 逐字复述 platform `apps/runtime_params/catalog.py` 的分组与键名
    assert tuning.SECTION_COLLECT == "collect"
    assert tuning.SECTION_ARCHIVE == "archive"
    assert tuning.KEY_SNAPSHOT_FLUSH_MS == "snapshot_flush_interval_ms"
    assert tuning.KEY_SNAPSHOT_TTL_S == "snapshot_ttl_s"
    assert tuning.KEY_HEARTBEAT_S == "heartbeat_interval_s"
    assert tuning.KEY_MAX_BACKOFF_S == "reconnect_max_backoff_s"
    assert tuning.KEY_PLAN_REFRESH_S == "plan_refresh_interval_s"
    assert tuning.KEY_ARCHIVE_ENABLED == "enabled"
    assert tuning.KEY_WRITER_FLUSH_MS == "writer_flush_interval_ms"
    assert tuning.KEY_BATCH_ROWS == "batch_rows"
    assert tuning.KEY_STREAM_MAXLEN == "stream_maxlen"
    assert tuning.KEY_BUFFER_MAX_ROWS == "buffer_max_rows"


def test_a_missing_override_reads_as_none(build_plan: Any) -> None:
    plan = build_plan()
    key = tuning.KEY_SNAPSHOT_FLUSH_MS
    assert tuning.int_param(plan, tuning.SECTION_COLLECT, key) is None
    assert tuning.int_param(None, tuning.SECTION_COLLECT, key) is None


def test_an_int_override_reads_back(build_plan: Any) -> None:
    plan = build_plan(params={"collect": {tuning.KEY_SNAPSHOT_FLUSH_MS: 500}})
    found = tuning.int_param(
        plan, tuning.SECTION_COLLECT, tuning.KEY_SNAPSHOT_FLUSH_MS
    )
    assert found == 500


def test_a_boolean_never_reads_back_as_an_int(build_plan: Any) -> None:
    # bool 是 int 的子类：`true` 静默变 1 是最难查的那类错
    plan = build_plan(params={"collect": {tuning.KEY_SNAPSHOT_FLUSH_MS: True}})
    found = tuning.int_param(
        plan, tuning.SECTION_COLLECT, tuning.KEY_SNAPSHOT_FLUSH_MS
    )
    assert found is None


def test_an_int_never_reads_back_as_a_switch(build_plan: Any) -> None:
    plan = build_plan(params={"archive": {tuning.KEY_ARCHIVE_ENABLED: 1}})
    found = tuning.bool_param(
        plan, tuning.SECTION_ARCHIVE, tuning.KEY_ARCHIVE_ENABLED
    )
    assert found is None


def test_a_float_param_accepts_ints_too(build_plan: Any) -> None:
    plan = build_plan(params={"collect": {tuning.KEY_HEARTBEAT_S: 5}})
    found = tuning.float_param(
        plan, tuning.SECTION_COLLECT, tuning.KEY_HEARTBEAT_S
    )
    assert found == 5.0


def test_the_sink_follows_the_plan_override(
    build_plan: Any, build_plan_view: Any
) -> None:
    plan = build_plan(
        params={
            "collect": {
                tuning.KEY_SNAPSHOT_FLUSH_MS: 1_000,
                tuning.KEY_SNAPSHOT_TTL_S: 90,
            }
        }
    )
    sink = SnapshotSink(
        store=RecordingStore(),
        interval_ms=300,
        ttl_s=60,
        plan=build_plan_view(plan),
    )
    assert sink._interval_s_now() == 1.0
    assert sink._ttl_s_now() == 90


def test_the_sink_falls_back_to_the_environment_default(
    build_plan_view: Any,
) -> None:
    sink = SnapshotSink(
        store=RecordingStore(),
        interval_ms=300,
        ttl_s=60,
        plan=build_plan_view(),
    )
    assert sink._interval_s_now() == 0.3
    assert sink._ttl_s_now() == 60


async def test_the_archive_master_switch_short_circuits_the_buffer(
    archive_stream: Any,
    build_plan: Any,
    build_plan_view: Any,
    build_source: Any,
    source_id: Any,
) -> None:
    # ⚠ 总开关压过点位各自的「记录历史」：关掉之后一行都不该进缓冲
    plan = build_plan(
        sources=(build_source(source_id=source_id),),
        params={"archive": {tuning.KEY_ARCHIVE_ENABLED: False}},
    )
    buffer = ArchiveBuffer(
        stream=archive_stream,
        plan=build_plan_view(plan),
        options=ArchiveOptions(
            flush_interval_ms=300,
            max_rows=100,
            batch_rows=10,
            stream_maxlen=1000,
        ),
    )
    await buffer.flush_once()
    buffer.sink_for(source_id)("outlet_temp", 21.5, TS_MS, "good")
    assert buffer.pending == 0


async def test_flipping_the_switch_back_on_resumes_archiving(
    archive_stream: Any,
    build_plan: Any,
    build_plan_view: Any,
    build_source: Any,
    source_id: Any,
) -> None:
    view = build_plan_view(
        build_plan(
            sources=(build_source(source_id=source_id),),
            params={"archive": {tuning.KEY_ARCHIVE_ENABLED: False}},
        )
    )
    buffer = ArchiveBuffer(
        stream=archive_stream,
        plan=view,
        options=ArchiveOptions(
            flush_interval_ms=300,
            max_rows=100,
            batch_rows=10,
            stream_maxlen=1000,
        ),
    )
    buffer.sink_for(source_id)("outlet_temp", 21.5, TS_MS, "good")
    view.replace(
        build_plan(version="v2", sources=(build_source(source_id=source_id),))
    )
    buffer.sink_for(source_id)("outlet_temp", 21.6, TS_MS + 1000, "good")
    assert buffer.pending == 1


def test_the_switch_env_default_gates_without_any_override(
    archive_stream: Any, build_plan_view: Any, source_id: Any
) -> None:
    buffer = ArchiveBuffer(
        stream=archive_stream,
        plan=build_plan_view(),
        options=ArchiveOptions(
            flush_interval_ms=300,
            max_rows=100,
            batch_rows=10,
            stream_maxlen=1000,
            is_enabled=False,
        ),
    )
    buffer.sink_for(source_id)("outlet_temp", 21.5, TS_MS, "good")
    assert buffer.pending == 0


def test_the_archive_enabled_env_default_is_on() -> None:
    # 出厂默认开着：默认关的话，装好就丢历史而且完全没有报错
    assert Settings.model_fields["archive_enabled"].default is True
