"""每日增量：把刚过去那一天的开机事件补进房间的当前批次。

口径见 docs/AC_PUBLISH_DESIGN.md §6。⚠ 与全量重算的关键差别有两处：

1. **写的是当前批次**，不新建也不切换——代价是批次从此不再是「一次跑出来的
   不可变快照」，换来的是当天数据次日即可训练，而不必每晚把厂商外库的三年
   全史重读一遍。
2. **整窗替换**而不是只插不删（见 `replace_window` 的理由）。
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from platform_server.apps.hvac.crud import (
    ac_startup_batch_crud,
    ac_startup_episode_crud,
)
from platform_server.apps.hvac.models import AcStartupBatch, AcStartupEpisode
from platform_server.apps.hvac.schemas import TimeWindow
from platform_server.apps.hvac.services.ac_startup_extract import (
    ExtractionContext,
    extract_window,
)
from platform_server.apps.hvac.services.ac_startup_rules import (
    LOGIC_VERSION,
    Episode,
)
from platform_server.apps.hvac.services.ac_startup_shards import daily_range

_logger = get_logger("platform.hvac.ac_startup_daily")

# 一次日增量的去向
DAILY_RUN_APPENDED = "appended"
DAILY_RUN_SKIPPED = "skipped"

_DATE_FORMAT = "%Y-%m-%d"


@dataclass(frozen=True)
class DailyRun:
    """一次日增量跑完之后的去向。

    ⚠ 跳过必须带原因并由调用方单独记一条日志：跳过与追加成功混成一条 event
    的话，一个从来没追加成功过的房间在日志里与正常的一模一样。
    """

    outcome: str
    appended: int = 0
    replaced: int = 0
    reason: str | None = None


def parse_business_date(raw: str) -> date | None:
    """`YYYY-MM-DD` → 业务日；读不懂给 None。

    Args: raw。
    """
    # ⚠ 这里刻意造一个 naive 的日期：业务日是「哪一天」而不是「哪一刻」，
    # 给它挂时区等于提前替 `day_bounds` 做了换算，而那一步要的是业务时区
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return None


def format_business_date(day: date) -> str:
    """业务日 → `YYYY-MM-DD`。

    Args: day。
    """
    return day.strftime(_DATE_FORMAT)


def local_today(timezone: str, *, now: datetime) -> date:
    """此刻在业务时区里是哪一天。

    Args: timezone, now。
    """
    return now.astimezone(ZoneInfo(timezone)).date()


def day_bounds(day: date, timezone: str) -> TimeWindow:
    """一个业务日在业务时区里的 00:00 与次日 00:00，换算成 UTC。

    ⚠ 必须按业务时区算而不是按 UTC 切：东八区的「当天」比 UTC 日早 8 小时，
    按 UTC 切出来的一天会把当地的早班劈成两半。

    Args: day, timezone。
    """
    zone = ZoneInfo(timezone)
    start = datetime.combine(day, time.min, tzinfo=zone)
    return TimeWindow(start=start, end=start + timedelta(days=1))


async def append_day(
    session: AsyncSession,
    context: ExtractionContext,
    *,
    room_id: uuid.UUID,
    day: date,
    timezone: str,
) -> DailyRun:
    """把一个业务日的开机事件追进这个房间的当前批次。

    ⚠ 全程幂等：整窗替换，同一天跑多少遍结果都一样。

    Args: session, context, room_id, day, timezone。
    """
    batch = await ac_startup_batch_crud.find_current(session, room_id)
    if batch is None:
        return DailyRun(
            outcome=DAILY_RUN_SKIPPED,
            reason="这个房间还没有当前批次，先做一次全量抽取",
        )
    mismatch = _fingerprint_mismatch(batch, context)
    if mismatch is not None:
        return DailyRun(outcome=DAILY_RUN_SKIPPED, reason=mismatch)
    return await _append(
        session, context, batch=batch, day=day, timezone=timezone
    )


def _fingerprint_mismatch(
    batch: AcStartupBatch, context: ExtractionContext
) -> str | None:
    """批次是按哪套规则算的、与现在这套一样吗；一样给 None。

    ⚠ 不一样就**跳过**而不是照追：混两套规则算出的事件比缺一天更糟——页面上
    这批数据会声称自己是按某一个指纹算的，而其中一部分不是。

    Args: batch, context。
    """
    if batch.logic_version != LOGIC_VERSION:
        return (
            f"当前批次按抽取逻辑 v{batch.logic_version} 算，"
            f"现在是 v{LOGIC_VERSION}，请先全量重算"
        )
    if batch.params_fingerprint != context.rules.fingerprint():
        return "当前批次的抽取参数与现在这套不符，请先全量重算"
    return None


async def _append(
    session: AsyncSession,
    context: ExtractionContext,
    *,
    batch: AcStartupBatch,
    day: date,
    timezone: str,
) -> DailyRun:
    """取数、抽取、整窗替换、顺延批次窗口。

    Args: session, context, batch, day, timezone。
    """
    bounds = day_bounds(day, timezone)
    window = daily_range(bounds.start, bounds.end, rules=context.rules)
    episodes = await extract_window(
        session, context, room_id=batch.room_id, window=window
    )
    replaced = await ac_startup_episode_crud.replace_window(
        session,
        batch_id=batch.id,
        window=TimeWindow(start=window.write_start, end=window.write_end),
        episodes=[_to_row(batch, episode) for episode in episodes],
    )
    await _extend(session, batch, until=bounds.end)
    return DailyRun(
        outcome=DAILY_RUN_APPENDED,
        appended=len(episodes),
        replaced=replaced,
    )


async def _extend(
    session: AsyncSession, batch: AcStartupBatch, *, until: datetime
) -> None:
    """把批次的窗口右端顺延到这一天的末尾，并重数一次事件总数。

    ⚠ 右端只前进不后退：一次补跑历史某一天的日增量，不该把窗口缩回去。
    ⚠ 事件总数重数而不是加减：整窗替换会既删又插，加减法在重跑同一天时会漂。

    Args: session, batch, until。
    """
    batch.window_end = max(batch.window_end, until)
    batch.episode_count = await ac_startup_episode_crud.count_by_batch(
        session, batch.id
    )
    await session.flush()


def _to_row(batch: AcStartupBatch, episode: Episode) -> AcStartupEpisode:
    """抽取结果 → 事件行。

    Args: batch, episode。
    """
    return AcStartupEpisode(
        batch_id=batch.id,
        room_id=batch.room_id,
        started_at=episode.started_at,
        running_set=list(episode.running_set),
        complied_at=episode.complied_at,
        duration_minutes=episode.duration_minutes,
        outcome=episode.outcome,
        readings={
            serial: dict(values) for serial, values in episode.readings.items()
        },
        idle_minutes=episode.idle_minutes,
    )


async def rooms_with_current_batch(session: AsyncSession) -> list[uuid.UUID]:
    """有当前批次的全部房间，按 id 升序。

    ⚠ 没有当前批次的房间不入队：没有可追加的地方，投进去只会每天多一条
    「跳过」的日志。

    Args: session。
    """
    return await ac_startup_batch_crud.rooms_with_current(session)
