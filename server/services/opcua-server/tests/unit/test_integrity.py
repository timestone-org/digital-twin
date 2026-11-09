"""守唯一约束到领域冲突的翻译：并发下「先查再插」漏掉的那一条必须是 409。"""

from typing import Any

import pytest
from sqlalchemy.exc import IntegrityError

from opcua_server.apps.instance.errors import PortUnavailable
from opcua_server.apps.instance.services.integrity import (
    flush_or_conflict,
    violated_constraint,
)


class _DriverError(Exception):
    """模拟 asyncpg 的唯一约束异常：约束名挂在 `constraint_name` 上。"""

    def __init__(self, constraint_name: str) -> None:
        super().__init__(constraint_name)
        self.constraint_name = constraint_name


def _integrity(constraint_name: str) -> IntegrityError:
    orig = Exception("duplicate key")
    orig.__cause__ = _DriverError(constraint_name)
    return IntegrityError("INSERT", {}, orig)


class _FailingSession:
    def __init__(self, error: Exception) -> None:
        self.error = error

    async def flush(self) -> None:
        raise self.error


def _session(error: Exception) -> Any:
    return _FailingSession(error)


def test_the_violated_constraint_is_read_from_the_driver_cause() -> None:
    assert violated_constraint(_integrity("uq_x")) == "uq_x"


async def test_a_registered_constraint_becomes_its_domain_conflict() -> None:
    session = _session(_integrity("uq_opcua_instances_port"))
    with pytest.raises(PortUnavailable):
        await flush_or_conflict(
            session,
            {"uq_opcua_instances_port": lambda: PortUnavailable("端口被占")},
        )


async def test_an_unregistered_constraint_is_raised_as_is() -> None:
    session = _session(_integrity("ck_something_else"))
    with pytest.raises(IntegrityError):
        await flush_or_conflict(
            session,
            {"uq_opcua_instances_port": lambda: PortUnavailable("端口被占")},
        )
