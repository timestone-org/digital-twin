"""断路器的状态机。

守的是 runtime-resilience §4.3 的三条口径：连续失败到阈值就短路、冷却后只放
**一个**探测、打开与合上都要留下日志痕迹。第二条尤其容易写漏——把等待中的
调用一起放开，等于在下游刚要站起来的时候再推它一把。
"""

import pytest

from lib.resilience import BreakerOpen, CircuitBreaker
from lib.testing.clock import FrozenClock

THRESHOLD = 3
RESET_AFTER_S = 30.0


def _breaker(clock: FrozenClock) -> CircuitBreaker:
    return CircuitBreaker(
        name="upstream",
        failure_threshold=THRESHOLD,
        reset_after_s=RESET_AFTER_S,
        clock=clock,
    )


def test_a_fresh_breaker_lets_calls_through() -> None:
    breaker = _breaker(FrozenClock())
    assert breaker.state == "closed"
    assert breaker.allow() is True


def test_failures_below_the_threshold_do_not_open_it() -> None:
    breaker = _breaker(FrozenClock())
    for _ in range(THRESHOLD - 1):
        breaker.record_failure()
    assert breaker.state == "closed"
    assert breaker.allow() is True


def test_reaching_the_threshold_opens_it() -> None:
    breaker = _breaker(FrozenClock())
    for _ in range(THRESHOLD):
        breaker.record_failure()
    assert breaker.state == "open"
    assert breaker.allow() is False


def test_a_success_resets_the_failure_run() -> None:
    breaker = _breaker(FrozenClock())
    breaker.record_failure()
    breaker.record_failure()
    breaker.record_success()
    breaker.record_failure()
    assert breaker.state == "closed"


def test_it_stays_open_until_the_cooldown_elapses() -> None:
    clock = FrozenClock()
    breaker = _breaker(clock)
    for _ in range(THRESHOLD):
        breaker.record_failure()
    clock.advance(RESET_AFTER_S - 1)
    assert breaker.state == "open"
    assert breaker.allow() is False


def test_the_cooldown_turns_it_half_open() -> None:
    clock = FrozenClock()
    breaker = _breaker(clock)
    for _ in range(THRESHOLD):
        breaker.record_failure()
    clock.advance(RESET_AFTER_S)
    assert breaker.state == "half_open"


def test_half_open_lets_exactly_one_probe_through() -> None:
    clock = FrozenClock()
    breaker = _breaker(clock)
    for _ in range(THRESHOLD):
        breaker.record_failure()
    clock.advance(RESET_AFTER_S)
    # 第一个是探测，其余的仍要被挡住——否则下游刚要恢复就被全量流量再打一次
    assert breaker.allow() is True
    assert breaker.allow() is False
    assert breaker.allow() is False


def test_a_probe_that_succeeds_closes_it() -> None:
    clock = FrozenClock()
    breaker = _breaker(clock)
    for _ in range(THRESHOLD):
        breaker.record_failure()
    clock.advance(RESET_AFTER_S)
    assert breaker.allow() is True
    breaker.record_success()
    assert breaker.state == "closed"
    assert breaker.allow() is True


def test_a_probe_that_fails_reopens_it_without_waiting_for_the_threshold() -> (
    None
):
    clock = FrozenClock()
    breaker = _breaker(clock)
    for _ in range(THRESHOLD):
        breaker.record_failure()
    clock.advance(RESET_AFTER_S)
    assert breaker.allow() is True
    breaker.record_failure()
    assert breaker.state == "open"
    assert breaker.allow() is False


def test_a_reopened_breaker_starts_a_fresh_cooldown() -> None:
    clock = FrozenClock()
    breaker = _breaker(clock)
    for _ in range(THRESHOLD):
        breaker.record_failure()
    clock.advance(RESET_AFTER_S)
    assert breaker.allow() is True
    breaker.record_failure()
    clock.advance(RESET_AFTER_S - 1)
    assert breaker.state == "open"
    clock.advance(1)
    assert breaker.state == "half_open"


def test_guard_raises_while_open() -> None:
    breaker = _breaker(FrozenClock())
    for _ in range(THRESHOLD):
        breaker.record_failure()
    with pytest.raises(BreakerOpen):
        breaker.guard()


def test_guard_is_silent_while_closed() -> None:
    breaker = _breaker(FrozenClock())
    breaker.guard()
    assert breaker.state == "closed"


def test_the_open_error_names_the_downstream_but_carries_no_detail() -> None:
    breaker = _breaker(FrozenClock())
    for _ in range(THRESHOLD):
        breaker.record_failure("连接被拒")
    with pytest.raises(BreakerOpen) as error:
        breaker.guard()
    # 消息面向最终用户：认得出是哪个下游，但不带任何内部细节
    assert "upstream" in str(error.value)
    assert "连接被拒" not in str(error.value)
