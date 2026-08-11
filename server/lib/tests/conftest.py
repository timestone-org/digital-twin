"""lib 测试的全局 fixture。只放真正全局的。

L2 的连接串从环境变量取；本机没有这两个依赖时整层跳过——
⚠ 跳过只允许在这里发生，且 CI 里由服务容器保证它们一定在，
CI 跑出任何 skip 都会被 `check_pytest_run.py` 判红。
"""

import os
import socket
from urllib.parse import urlsplit

import pytest

from lib.logging import configure_logging


@pytest.fixture(autouse=True)
def _quiet_logging() -> None:
    """把日志压到 ERROR，避免测试输出被结构化日志淹没。"""
    configure_logging(
        service="lib-test",
        role="test",
        instance="test",
        level="ERROR",
        log_format="json",
    )


def _reachable(url: str, default_port: int) -> bool:
    parts = urlsplit(url)
    if parts.hostname is None:
        return False
    try:
        with socket.create_connection(
            (parts.hostname, parts.port or default_port), timeout=2
        ):
            return True
    except OSError:
        return False


@pytest.fixture(scope="session")
def postgres_dsn() -> str:
    """真实 Postgres 的连接串。CI 由服务容器提供。"""
    url = os.environ.get("LIB_TEST_POSTGRES_DSN", "")
    if not url or not _reachable(url, 5432):
        pytest.skip("本机连不到 Postgres")
    return url


@pytest.fixture(scope="session")
def redis_url() -> str:
    """真实 Redis 的连接串。CI 由服务容器提供。"""
    url = os.environ.get("LIB_TEST_REDIS_URL", "")
    if not url or not _reachable(url, 6379):
        pytest.skip("本机连不到 Redis")
    return url
