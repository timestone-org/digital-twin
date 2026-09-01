"""建模面自己的依赖注入件。

组合根、事务、闸 2 与幂等键是服务级公共件，在 `platform_server.deps` 里；
本模块只补几个带写权限判定的写上下文。
"""

from datetime import UTC, datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import Depends

from lib.auth import CallerContext
from platform_server.apps.modeling.catalog import (
    MODELING_MANAGE,
    MODELING_PUBLISH,
    MODELING_RUN,
)
from platform_server.apps.modeling.services import Actor, RunContext
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
    "get_container",
    "get_idempotency_key",
    "get_manage_context",
    "get_publish_context",
    "get_run_context",
    "get_session",
    "require",
]

# 一小时的秒数，把时区偏移换算成分钟用
_SECONDS_PER_MINUTE = 60


def get_manage_context(
    container: Annotated[Container, Depends(get_container)],
    caller: Annotated[CallerContext, Depends(require(MODELING_MANAGE))],
    idempotency_key: Annotated[str | None, Depends(get_idempotency_key)],
) -> WriteGate:
    """建改删流水线、校验、导入用的写上下文。

    Args: container, caller, idempotency_key。
    """
    return WriteGate(
        idempotency=container.idempotency,
        idempotency_key=idempotency_key,
        caller=caller,
    )


def get_publish_context(
    container: Annotated[Container, Depends(get_container)],
    caller: Annotated[CallerContext, Depends(require(MODELING_PUBLISH))],
    idempotency_key: Annotated[str | None, Depends(get_idempotency_key)],
) -> WriteGate:
    """发布模型版本与建改删绑定用的写上下文。

    ⚠ 与 `manage` 分成两个码：绑定生效后，引用那条公式的每一张台账的数值都会
    跟着模型走（docs/MODELING_DESIGN.md §9.1）。
    Args: container, caller, idempotency_key。
    """
    return WriteGate(
        idempotency=container.idempotency,
        idempotency_key=idempotency_key,
        caller=caller,
    )


def get_run_context(
    container: Annotated[Container, Depends(get_container)],
    caller: Annotated[CallerContext, Depends(require(MODELING_RUN))],
) -> RunContext:
    """发起 / 取消运行用的上下文，连同业务时区。

    ⚠ 时区从组合根注入，算子不自己读配置：按 UTC 算时间特征会整体偏 8 小时
    且不报任何错（§3.3）。
    Args: container, caller。
    """
    now = datetime.now(UTC)
    return RunContext(
        actor=Actor(user_id=str(caller.user_id), name=caller.username),
        tz_offset_minutes=_offset_minutes(
            container.settings.dataset_bucket_timezone, now
        ),
        now=now,
    )


def _offset_minutes(zone_name: str, now: datetime) -> int:
    """业务时区在这一刻相对 UTC 的分钟偏移。

    ⚠ 按「此刻」算而不是取一个常数：有夏令时的时区上，常数会在换季那天让全部
    时间特征整体错一小时，而没有任何一处会报错。
    Args: zone_name, now。
    """
    offset = now.astimezone(ZoneInfo(zone_name)).utcoffset()
    if offset is None:  # pragma: no cover - ZoneInfo 恒给得出偏移
        return 0
    return int(offset.total_seconds() // _SECONDS_PER_MINUTE)
