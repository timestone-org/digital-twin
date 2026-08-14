"""守关停顺序：它**不是启动顺序的逆序**，而且顺序错了会丢数据。

⚠ 两个缓冲必须比会话晚停（要接住拆会话时补交的尾帧），归档 writer 又比缓冲
晚停（它要把那一帧排进库），连接池最后关。见 runtime-resilience §8 与
CONTEXT.md §4。
"""

from collector_server.app import hooks_of
from collector_server.container import build_container
from collector_server.settings import Settings


def _names_by_shutdown(settings: Settings) -> list[str]:
    hooks = hooks_of(build_container(settings))
    ordered = sorted(hooks, key=lambda hook: hook.shutdown_order)
    return [hook.name for hook in ordered if hook.shutdown is not None]


def _names_by_startup(settings: Settings) -> list[str]:
    hooks = hooks_of(build_container(settings))
    ordered = sorted(hooks, key=lambda hook: hook.startup_order)
    return [hook.name for hook in ordered if hook.startup is not None]


def test_shutdown_runs_in_the_declared_order(settings: Settings) -> None:
    assert _names_by_shutdown(settings) == [
        "command_bus",
        "supervisor",
        "snapshot_sink",
        "archive_buffer",
        "archive_writer",
        "database",
        "redis",
    ]


def test_shutdown_is_not_the_reverse_of_startup(settings: Settings) -> None:
    started = _names_by_startup(settings)
    stopped = _names_by_shutdown(settings)
    assert stopped != list(reversed(started))


def test_the_sink_outlives_the_sessions(settings: Settings) -> None:
    stopped = _names_by_shutdown(settings)
    assert stopped.index("supervisor") < stopped.index("snapshot_sink")


def test_new_work_stops_before_anything_is_torn_down(
    settings: Settings,
) -> None:
    stopped = _names_by_shutdown(settings)
    assert stopped[0] == "command_bus"


def test_connections_close_last(settings: Settings) -> None:
    stopped = _names_by_shutdown(settings)
    assert stopped[-2:] == ["database", "redis"]


def test_the_archive_writer_outlives_both_buffers(settings: Settings) -> None:
    stopped = _names_by_shutdown(settings)
    assert stopped.index("archive_buffer") < stopped.index("archive_writer")


def test_the_archive_buffer_outlives_the_sessions(settings: Settings) -> None:
    stopped = _names_by_shutdown(settings)
    assert stopped.index("supervisor") < stopped.index("archive_buffer")


def test_the_archive_buffer_starts_before_the_sessions_produce_values(
    settings: Settings,
) -> None:
    started = _names_by_startup(settings)
    assert started.index("archive_buffer") < started.index("supervisor")


def test_the_sink_starts_before_the_sessions_produce_values(
    settings: Settings,
) -> None:
    started = _names_by_startup(settings)
    assert started.index("snapshot_sink") < started.index("supervisor")


def test_selfcheck_runs_first(settings: Settings) -> None:
    assert _names_by_startup(settings)[0] == "startup_selfcheck"
