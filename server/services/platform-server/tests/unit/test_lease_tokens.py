"""单活租约的令牌必须每个进程唯一。

⚠ 同一台机器上两个进程（单机部署、手动多起一个、重启重叠）主机名相同：拿
主机名当令牌，两边的续期 CAS 都会成功，于是两个都以为自己是主。
"""

from platform_server.container import PUBLISHER_LEASE_KEY, _build_lease
from platform_server.lease import RedisLease
from unit.wiring_fakes import build_settings


def _token_of(lease: object) -> str:
    """取租约的令牌。Args: lease。"""
    assert isinstance(lease, RedisLease)
    return lease._token  # 理由 —— 断言装配出的令牌


def test_two_processes_on_one_host_hold_different_tokens() -> None:
    settings = build_settings(instance="same-host")
    first = _token_of(_build_lease(settings, PUBLISHER_LEASE_KEY))
    second = _token_of(_build_lease(settings, PUBLISHER_LEASE_KEY))
    assert first != second


def test_the_token_still_names_the_instance() -> None:
    # 排障时要能从 Redis 里那把租约看出是哪台机器拿着
    settings = build_settings(instance="same-host")
    token = _token_of(_build_lease(settings, PUBLISHER_LEASE_KEY))
    assert token.startswith("same-host:")
