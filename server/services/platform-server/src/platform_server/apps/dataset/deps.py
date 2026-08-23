"""台账面自己的依赖注入件。

组合根、事务、闸 2 与幂等键是服务级公共件，在 `platform_server.deps` 里；
本模块只补几个带写权限判定的写上下文。
"""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import Depends, Query

from lib.auth import CallerContext
from lib.utils.timeutils import to_utc
from platform_server.apps.dataset.catalog import (
    DATASET_BACKFILL,
    DATASET_MANAGE,
    DATASET_OVERRIDE,
    DATASET_RECORD_WRITE,
    FORMULA_MANAGE,
)
from platform_server.apps.dataset.services import (
    Actor,
    BackfillRunner,
    RecordLocator,
    RecordWriter,
)
from platform_server.container import Container
from platform_server.deps import (
    WriteGate,
    get_container,
    get_idempotency_key,
    get_session,
    require,
)

__all__ = [
    "WriteGate",
    "get_backfill_gate",
    "get_backfill_runner",
    "get_backfill_writer",
    "get_container",
    "get_formula_context",
    "get_idempotency_key",
    "get_manage_context",
    "get_override_writer",
    "get_record_locator",
    "get_record_writer",
    "get_session",
    "require",
]


def get_manage_context(
    container: Annotated[Container, Depends(get_container)],
    caller: Annotated[CallerContext, Depends(require(DATASET_MANAGE))],
    idempotency_key: Annotated[str | None, Depends(get_idempotency_key)],
) -> WriteGate:
    """增删改台账与列用的写上下文。

    ⚠ 直接用 `WriteGate` 而不另立子类：台账面不碰现场设备、也不广播采集计划，
    没有第三个协作者要带，空子类只是一层没有内容的间接。
    Args: container, caller, idempotency_key。
    """
    return WriteGate(
        idempotency=container.idempotency,
        idempotency_key=idempotency_key,
        caller=caller,
    )


def get_formula_context(
    container: Annotated[Container, Depends(get_container)],
    caller: Annotated[CallerContext, Depends(require(FORMULA_MANAGE))],
    idempotency_key: Annotated[str | None, Depends(get_idempotency_key)],
) -> WriteGate:
    """建改删库公式用的写上下文。

    ⚠ 与台账的 `manage` 分成两个码：改一条库公式会同时改掉**所有**引用它的
    台账列，爆炸半径比改单张表的一列大一个量级（§9）。
    Args: container, caller, idempotency_key。
    """
    return WriteGate(
        idempotency=container.idempotency,
        idempotency_key=idempotency_key,
        caller=caller,
    )


def get_record_writer(
    container: Annotated[Container, Depends(get_container)],
    caller: Annotated[CallerContext, Depends(require(DATASET_RECORD_WRITE))],
) -> RecordWriter:
    """录入 / 编辑 / 删除单行用的写上下文。

    Args: container, caller。
    """
    return _writer(container, caller)


def get_override_writer(
    container: Annotated[Container, Depends(get_container)],
    caller: Annotated[CallerContext, Depends(require(DATASET_OVERRIDE))],
) -> RecordWriter:
    """人工修正用的写上下文。

    ⚠ 与录入分成两个码：修正值优先于点位聚合值，等同于篡改台账（§9）。
    Args: container, caller。
    """
    return _writer(container, caller)


def get_backfill_writer(
    container: Annotated[Container, Depends(get_container)],
    caller: Annotated[CallerContext, Depends(require(DATASET_BACKFILL))],
) -> RecordWriter:
    """全表重算用的写上下文。大批量改写历史行且吃满数据库，故自成一个码。

    Args: container, caller。
    """
    return _writer(container, caller)


def get_backfill_gate(
    container: Annotated[Container, Depends(get_container)],
    caller: Annotated[CallerContext, Depends(require(DATASET_BACKFILL))],
    idempotency_key: Annotated[str | None, Depends(get_idempotency_key)],
) -> WriteGate:
    """起 / 取消历史回填用的写上下文。

    ⚠ 与 `get_backfill_writer` 分成两件：那一件带的是报脏口与操作人（重算要
    署名），这一件带的是幂等键——回填是长任务，重试不该变成第二个任务（§6.3）。
    Args: container, caller, idempotency_key。
    """
    return WriteGate(
        idempotency=container.idempotency,
        idempotency_key=idempotency_key,
        caller=caller,
    )


def get_backfill_runner(
    container: Annotated[Container, Depends(get_container)],
) -> BackfillRunner:
    """回填的起跑口。一个进程一份，随容器装配。

    Args: container。
    """
    return container.dataset.backfill


def get_record_locator(
    table_id: uuid.UUID,
    row_id: uuid.UUID,
    ts: Annotated[datetime | None, Query()] = None,
) -> RecordLocator:
    """从路径与查询参数拼出一行的定位。

    ⚠ `ts` 是分区键：带上直接命中 chunk，不带就是跨 chunk 扫描（§6.1）。
    Args: table_id, row_id, ts。
    """
    return RecordLocator(
        table_id=table_id,
        row_id=row_id,
        ts=None if ts is None else to_utc(ts),
    )


def _writer(container: Container, caller: CallerContext) -> RecordWriter:
    """把组合根里的报脏口与时区、加上调用者，拧成一个写上下文。

    Args: container, caller。
    """
    return RecordWriter(
        dirty=container.dataset.dirty,
        timezone=container.dataset.timezone,
        actor=Actor(user_id=str(caller.user_id), name=caller.username),
    )
