"""lib 测试的全局 fixture。只放真正全局的。"""

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
