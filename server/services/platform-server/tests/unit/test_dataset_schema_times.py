"""台账入参里的时刻：不带时区的一律按 UTC 读。

⚠ naive 时刻一路到 asyncpg 会被当成**进程本地时间**：东八区的机器上整段窗口
平移 8 小时，而写入端点把同一个串当 UTC，两边对不上也不报错。
"""

from datetime import UTC, datetime

from platform_server.apps.dataset.schemas import OverrideBulkClearIn


def test_a_naive_moment_is_read_as_utc_at_the_boundary() -> None:
    payload = OverrideBulkClearIn.model_validate(
        {"column_keys": ["a"], "since": "2026-01-01T00:00:00"}
    )
    assert payload.since is not None
    assert payload.since == datetime(2026, 1, 1, tzinfo=UTC)
    assert payload.since.tzinfo is UTC


def test_an_offset_moment_is_converted_to_utc() -> None:
    payload = OverrideBulkClearIn.model_validate(
        {"column_keys": ["a"], "until": "2026-01-01T08:00:00+08:00"}
    )
    assert payload.until is not None
    assert payload.until == datetime(2026, 1, 1, tzinfo=UTC)
    assert payload.until.tzinfo is UTC
