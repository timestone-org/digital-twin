"""数据集目录、数据源绑定与达标范围。

绑定把「一台空调的一个数据集」指向外部库里的一个对象；达标范围是后期判定是否
达标的计算标准。口径见 docs/AC_DATA_DESIGN.md §3–§5。
"""

import re
import uuid
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors import FieldError, ValidationFailed
from lib.logging import get_logger
from platform_server.apps.hvac.crud import (
    ac_data_binding_crud,
    ac_metric_limit_crud,
    ac_unit_crud,
)
from platform_server.apps.hvac.datasets import (
    DATASETS,
    DatasetSpec,
    find_dataset,
    limitable_metric_keys,
)
from platform_server.apps.hvac.errors import (
    AcUnitNotFound,
    DatasetNotFound,
    MetricUnknown,
    SourceObjectInvalid,
)
from platform_server.apps.hvac.models import AcDataBinding, AcMetricLimit
from platform_server.apps.hvac.schemas import (
    AcDataBindingOut,
    AcDataBindingPutIn,
    AcDataBindingsOut,
    DatasetOut,
    DatasetsOut,
    MetricLimitIn,
    MetricLimitOut,
    MetricLimitsOut,
    MetricLimitsPutIn,
    MetricOut,
)

_logger = get_logger("platform.hvac.ac_data")

# ⚠ 标识符不能参数化，对象名最终要拼进 SQL，故先过白名单再方括号引用。
# ⚠ 必须 `fullmatch`：Python 的 `$` 也匹配结尾换行，`"K01\n"` 能骗过 `match`。
# ⚠ 不放行 `-`：它不是合法的裸 T-SQL 标识符。
_SOURCE_OBJECT = re.compile(r"[A-Za-z0-9_]{1,128}")


def list_datasets() -> DatasetsOut:
    """数据集目录。前端的页签与指标选择器都由它渲染。"""
    return DatasetsOut(
        items=[
            DatasetOut(
                key=dataset.key,
                name=dataset.name,
                description=dataset.description,
                metrics=[
                    MetricOut(
                        key=metric.key,
                        name=metric.name,
                        unit=metric.unit,
                        group=metric.group,
                        is_limitable=metric.is_limitable,
                        is_charted_by_default=metric.is_charted_by_default,
                    )
                    for metric in dataset.metrics
                ],
            )
            for dataset in DATASETS
        ]
    )


def require_dataset(key: str) -> DatasetSpec:
    """取数据集，不存在即 404。

    Args: key。
    """
    dataset = find_dataset(key)
    if dataset is None:
        raise DatasetNotFound("数据集不存在")
    return dataset


def ensure_valid_source_object(name: str) -> str:
    """校验数据源对象名，不合法即 422。

    Args: name。
    """
    if _SOURCE_OBJECT.fullmatch(name) is None:
        raise SourceObjectInvalid("数据源对象名只允许字母、数字与下划线")
    return name


async def list_bindings(
    session: AsyncSession, *, ac_unit_id: uuid.UUID
) -> AcDataBindingsOut:
    """一台空调的全部数据源绑定。

    Args: session, ac_unit_id。
    """
    await _require_ac_unit(session, ac_unit_id)
    rows = await ac_data_binding_crud.list_by_ac_unit(session, ac_unit_id)
    return AcDataBindingsOut(items=[_to_binding_out(row) for row in rows])


async def put_binding(
    session: AsyncSession,
    *,
    ac_unit_id: uuid.UUID,
    dataset: str,
    payload: AcDataBindingPutIn,
) -> AcDataBindingOut:
    """设置绑定。同一空调同一数据集只有一条，重复调用是覆盖不是新增。

    ⚠ 这里只校验对象名的形状。它在外部库里**是否真的存在、列形状对不对**要连
    外库才知道，那道校验随读数面一起落地；在此之前绑一个不存在的视图不会被拦。
    Args: session, ac_unit_id, dataset, payload。
    """
    await _require_ac_unit(session, ac_unit_id)
    require_dataset(dataset)
    source_object = ensure_valid_source_object(payload.source_object)
    binding = await ac_data_binding_crud.find(session, ac_unit_id, dataset)
    if binding is None:
        binding = AcDataBinding(
            ac_unit_id=ac_unit_id,
            dataset=dataset,
            source_object=source_object,
        )
        session.add(binding)
    else:
        binding.source_object = source_object
    await session.flush()
    _logger.info(
        "ac_data_binding_set",
        "数据源绑定已设置",
        ac_unit_id=str(ac_unit_id),
        dataset=dataset,
    )
    return _to_binding_out(binding)


async def delete_binding(
    session: AsyncSession, *, ac_unit_id: uuid.UUID, dataset: str
) -> None:
    """解除绑定。没绑过也算成功——DELETE 必须幂等。

    Args: session, ac_unit_id, dataset。
    """
    await _require_ac_unit(session, ac_unit_id)
    require_dataset(dataset)
    binding = await ac_data_binding_crud.find(session, ac_unit_id, dataset)
    if binding is None:
        return
    await ac_data_binding_crud.delete(session, binding)
    _logger.info(
        "ac_data_binding_cleared",
        "数据源绑定已解除",
        ac_unit_id=str(ac_unit_id),
        dataset=dataset,
    )


async def list_metric_limits(
    session: AsyncSession, *, ac_unit_id: uuid.UUID
) -> MetricLimitsOut:
    """一台空调的全部达标范围。

    Args: session, ac_unit_id。
    """
    await _require_ac_unit(session, ac_unit_id)
    rows = await ac_metric_limit_crud.list_by_ac_unit(session, ac_unit_id)
    return MetricLimitsOut(items=[_to_limit_out(row) for row in rows])


async def put_metric_limits(
    session: AsyncSession, *, ac_unit_id: uuid.UUID, payload: MetricLimitsPutIn
) -> MetricLimitsOut:
    """覆盖式设置达标范围。请求里没出现的指标视为清除。

    Args: session, ac_unit_id, payload。
    """
    await _require_ac_unit(session, ac_unit_id)
    wanted = _validated_limits(payload.items)
    existing = {
        row.metric: row
        for row in await ac_metric_limit_crud.list_by_ac_unit(
            session, ac_unit_id
        )
    }
    for metric, row in existing.items():
        if metric not in wanted:
            await ac_metric_limit_crud.delete(session, row)
    for metric, bounds in wanted.items():
        lower, upper = bounds
        row = existing.get(metric)
        if row is None:
            session.add(
                AcMetricLimit(
                    ac_unit_id=ac_unit_id,
                    metric=metric,
                    lower_limit=lower,
                    upper_limit=upper,
                )
            )
        else:
            row.lower_limit = lower
            row.upper_limit = upper
    await session.flush()
    _logger.info(
        "ac_metric_limits_set",
        "达标范围已设置",
        ac_unit_id=str(ac_unit_id),
        metric_count=len(wanted),
    )
    return await list_metric_limits(session, ac_unit_id=ac_unit_id)


def _validated_limits(
    items: list[MetricLimitIn],
) -> dict[str, tuple[Decimal | None, Decimal | None]]:
    """校验并归一化入参。两端都空的条目当作不配置，直接丢掉。

    Args: items。
    """
    allowed = limitable_metric_keys()
    resolved: dict[str, tuple[Decimal | None, Decimal | None]] = {}
    for index, item in enumerate(items):
        if item.metric not in allowed:
            raise MetricUnknown(f"指标 {item.metric} 不支持配置达标范围")
        if item.metric in resolved:
            raise _field_invalid(index, "duplicated_metric", "指标重复出现")
        if item.lower_limit is None and item.upper_limit is None:
            continue
        if (
            item.lower_limit is not None
            and item.upper_limit is not None
            and item.lower_limit > item.upper_limit
        ):
            raise _field_invalid(index, "bounds_inverted", "下限不能高于上限")
        resolved[item.metric] = (item.lower_limit, item.upper_limit)
    return resolved


def _field_invalid(index: int, code: str, message: str) -> ValidationFailed:
    """构造一条指向具体条目的字段级错误。

    Args: index, code, message。
    """
    return ValidationFailed(
        message,
        details=(
            FieldError(
                field=f"items[{index}].metric", code=code, message=message
            ),
        ),
    )


async def _require_ac_unit(
    session: AsyncSession, ac_unit_id: uuid.UUID
) -> None:
    if await ac_unit_crud.get(session, ac_unit_id) is None:
        raise AcUnitNotFound("空调不存在")


def _to_binding_out(binding: AcDataBinding) -> AcDataBindingOut:
    return AcDataBindingOut(
        dataset=binding.dataset,
        source_object=binding.source_object,
        created_at=binding.created_at,
        updated_at=binding.updated_at,
    )


def _to_limit_out(row: AcMetricLimit) -> MetricLimitOut:
    return MetricLimitOut(
        metric=row.metric,
        lower_limit=row.lower_limit,
        upper_limit=row.upper_limit,
    )
