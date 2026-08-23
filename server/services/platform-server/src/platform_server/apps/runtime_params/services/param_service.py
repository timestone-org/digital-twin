"""运行参数的读写。事务边界在这一层：crud 不提交，api 不写业务。

读 = 环境变量给的默认值叠加覆盖行；`:reset` = 删掉该分组的覆盖行。

⚠ 环境变量是永久默认值而不是一次性播种：这里没有任何一步会把配置对象上的
取值抄进表里，表里也不会出现一行与默认值相等的覆盖——「改回默认」删掉那一行
而不是存一个等值，否则这一项从此不再跟随环境变量，界面上却看不出任何区别。
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors import FieldError, ValidationFailed
from lib.logging import get_logger
from platform_server.apps.runtime_params.catalog import (
    COLLECT_SCOPE,
    INT_KIND,
    SECTION_WRITE_CODES,
    SWITCH_KIND,
    ParamSpec,
    ParamValue,
    env_name_of,
    spec_of,
    specs_of,
)
from platform_server.apps.runtime_params.crud import (
    OverrideWrite,
    override_crud,
)
from platform_server.apps.runtime_params.errors import RuntimeParamUnknown
from platform_server.apps.runtime_params.models import RuntimeParamOverride
from platform_server.apps.runtime_params.schemas import (
    RuntimeParamOut,
    RuntimeParamWriteIn,
)
from platform_server.settings import Settings

_logger = get_logger("platform.runtime_params")


@dataclass(frozen=True)
class Effective:
    """一项此刻的有效值与它的来历。没有覆盖行时后三个字段都是 None。"""

    value: ParamValue
    previous: ParamValue | None
    updated_at: datetime | None
    updated_by: str | None


async def read_items(
    session: AsyncSession,
    *,
    settings: Settings,
    section: str | None,
    scope: tuple[str, ...],
) -> list[RuntimeParamOut]:
    """列出运行参数。给了 `section` 就只回那一组，给了不认识的名字即 400。

    ⚠ `scope` 是这条路由服务的分组集合：分组按写权限码拆在两条路由上
    （/runtime-params 与 /collect-runtime-params），越界的分组名按不存在处理，
    否则拿大屏读码就能看采集参数。
    Args: session, settings, section, scope。
    """
    if section is None:
        names = scope
    else:
        require_in_scope(section, scope)
        names = (section,)
    grouped = [
        await section_items(session, settings=settings, section=name)
        for name in names
    ]
    return [item for items in grouped for item in items]


def require_in_scope(section: str, scope: tuple[str, ...]) -> None:
    """分组必须在这条路由的服务范围内，否则按不存在处理。

    Args: section, scope。
    """
    if section not in scope:
        raise RuntimeParamUnknown(f"没有名为「{section}」的运行参数分组")
    require_specs(section)


async def section_items(
    session: AsyncSession, *, settings: Settings, section: str
) -> list[RuntimeParamOut]:
    """一个分组此刻的全部条目，顺序即目录顺序。

    Args: session, settings, section。
    """
    specs = require_specs(section)
    stored = await stored_rows(session, section)
    return [
        to_param_out(spec, settings=settings, row=stored.get(spec.key))
        for spec in specs
    ]


async def write_section(
    session: AsyncSession,
    *,
    settings: Settings,
    section: str,
    payload: RuntimeParamWriteIn,
    actor: str,
) -> list[RuntimeParamOut]:
    """改一个分组里的若干项。没给的项不动。

    Args: session, settings, section, payload, actor。
    """
    require_specs(section)
    stored = await stored_rows(session, section)
    for key, given in payload.values.items():
        spec = require_spec(section, key)
        value = validated(spec, given)
        if value == spec.read(settings):
            await override_crud.remove(session, section=section, key=key)
            continue
        current = effective_of(spec, settings=settings, row=stored.get(key))
        await override_crud.upsert(
            session,
            OverrideWrite(
                section=section,
                key=key,
                value=value,
                previous=current.value,
                actor=actor,
            ),
        )
    await session.flush()
    _logger.info(
        "runtime_params_updated",
        "运行参数已更新",
        section=section,
        keys=sorted(payload.values),
    )
    return await section_items(session, settings=settings, section=section)


async def reset_section(
    session: AsyncSession, *, settings: Settings, section: str, actor: str
) -> list[RuntimeParamOut]:
    """删掉该分组的全部覆盖行，此后重新跟随环境变量。

    Args: session, settings, section, actor。
    """
    require_specs(section)
    removed = len(await stored_rows(session, section))
    await override_crud.remove_section(session, section)
    await session.flush()
    _logger.info(
        "runtime_params_reset",
        "运行参数已恢复默认",
        section=section,
        removed=removed,
        actor=actor,
    )
    return await section_items(session, settings=settings, section=section)


async def effective_values(
    session: AsyncSession, *, settings: Settings, section: str
) -> dict[str, ParamValue]:
    """一个分组此刻的**全部有效值** `{键: 值}`，给本进程内的消费者用。

    ⚠ 与 `overrides_for_plan` 相反：那一份只回稀疏的覆盖值（消费者在别的进程，
    自己有一套环境变量兜底），这一份把回落也做完——同进程的消费者拿到的必须是
    「此刻真正生效的那个数」，让它自己再兜一遍就是两份口径。
    Args: session, settings, section。
    """
    specs = require_specs(section)
    stored = await stored_rows(session, section)
    return {
        spec.key: effective_of(
            spec, settings=settings, row=stored.get(spec.key)
        ).value
        for spec in specs
    }


async def overrides_for_plan(
    session: AsyncSession,
) -> dict[str, dict[str, ParamValue]]:
    """采集/归档分组当前的覆盖值（稀疏），给采集计划下发用。

    ⚠ 只回**覆盖值**不回默认值：没覆盖的键由 collector 自己的环境变量兜底。
    形状与登记类型不符的行按未覆盖处理（与读面同一条口径）。
    Args: session。
    """
    out: dict[str, dict[str, ParamValue]] = {}
    for section in COLLECT_SCOPE:
        stored = await stored_rows(session, section)
        values = {
            key: value
            for key, row in stored.items()
            if (spec := spec_of(section, key)) is not None
            and (value := stored_value(spec, row.value_json)) is not None
        }
        if values:
            out[section] = values
    return out


async def stored_rows(
    session: AsyncSession, section: str
) -> dict[str, RuntimeParamOverride]:
    """一个分组的覆盖行，按键索引。

    Args: session, section。
    """
    rows = await override_crud.list_section(session, section)
    return {row.key: row for row in rows}


def to_param_out(
    spec: ParamSpec, *, settings: Settings, row: RuntimeParamOverride | None
) -> RuntimeParamOut:
    """一项的对外形态：登记信息 + 有效值 + 默认值。

    Args: spec, settings, row。
    """
    current = effective_of(spec, settings=settings, row=row)
    return RuntimeParamOut(
        section=spec.section,
        key=spec.key,
        env_name=env_name_of(spec),
        write_code=SECTION_WRITE_CODES[spec.section],
        label=spec.label,
        hint=spec.hint,
        kind=spec.kind,
        unit=spec.unit,
        step=spec.step,
        minimum=spec.minimum,
        maximum=spec.maximum,
        tier=spec.tier,
        danger=spec.danger,
        value=current.value,
        default_value=spec.read(settings),
        previous_value=current.previous,
        is_overridden=current.updated_at is not None,
        updated_at=current.updated_at,
        updated_by=current.updated_by,
    )


def effective_of(
    spec: ParamSpec, *, settings: Settings, row: RuntimeParamOverride | None
) -> Effective:
    """一项此刻的有效值：有覆盖行就用它，否则回落到环境变量。

    Args: spec, settings, row。
    """
    default = spec.read(settings)
    stored = None if row is None else stored_value(spec, row.value_json)
    if row is None or stored is None:
        if row is not None:
            _logger.warning(
                "runtime_param_override_unreadable",
                "覆盖值的形状与登记类型不符，本项按未覆盖处理",
                section=spec.section,
                key=spec.key,
            )
        return _untouched(default)
    return Effective(
        value=stored,
        previous=stored_value(spec, row.previous_value_json),
        updated_at=row.updated_at,
        updated_by=row.updated_by or None,
    )


def stored_value(spec: ParamSpec, raw: Any) -> ParamValue | None:
    """把 JSONB 里的覆盖值按登记类型收敛；形状不对给 None。

    ⚠ `Any` 只在这一处：JSONB 出来就是无类型的。布尔要按类型分流——它在
    Python 里是 int 的子类，不挡就会让一个 `true` 悄悄变成 1，或反过来。
    Args: spec, raw。
    """
    if spec.kind == SWITCH_KIND:
        return raw if isinstance(raw, bool) else None
    if isinstance(raw, bool) or not isinstance(raw, int | float):
        return None
    return raw


def require_specs(section: str) -> tuple[ParamSpec, ...]:
    """一个分组的全部登记项，没这个分组即 400。

    Args: section。
    """
    specs = specs_of(section)
    if specs is None:
        raise RuntimeParamUnknown(f"没有名为「{section}」的运行参数分组")
    return specs


def require_spec(section: str, key: str) -> ParamSpec:
    """一项的登记信息，没登记即 400。

    Args: section, key。
    """
    spec = spec_of(section, key)
    if spec is None:
        raise RuntimeParamUnknown(f"运行参数目录里没有「{key}」这一项")
    return spec


def validated(spec: ParamSpec, value: ParamValue) -> ParamValue:
    """过登记的类型与范围闸。越界一律拒绝，**不静默夹到边界**。

    Args: spec, value。
    """
    if spec.kind == SWITCH_KIND:
        if not isinstance(value, bool):
            raise _rejected(
                spec, "runtime_param_not_a_switch", "这一项只接受开或关"
            )
        return value
    if isinstance(value, bool):
        raise _rejected(spec, "runtime_param_not_a_number", "这一项要的是数字")
    if spec.kind == INT_KIND and not isinstance(value, int):
        raise _rejected(
            spec, "runtime_param_not_an_integer", "这一项只接受整数"
        )
    if not spec.minimum <= value <= spec.maximum:
        raise _rejected(
            spec,
            "runtime_param_out_of_range",
            f"取值要在 {spec.minimum} 到 {spec.maximum} 之间",
        )
    return value


def _untouched(default: ParamValue) -> Effective:
    """没有覆盖行时的有效值。

    Args: default。
    """
    return Effective(
        value=default, previous=None, updated_at=None, updated_by=None
    )


def _rejected(spec: ParamSpec, code: str, message: str) -> ValidationFailed:
    """造一条指到具体字段上的校验失败（`ValidationFailed` → 400）。

    Args: spec, code, message。
    """
    return ValidationFailed(
        f"{spec.label}：{message}",
        details=(
            FieldError(field=f"values.{spec.key}", code=code, message=message),
        ),
    )
