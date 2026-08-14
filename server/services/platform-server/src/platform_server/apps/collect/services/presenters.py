"""ORM 模型 → 对外模型。转换只在这一处发生，HTTP 层拿不到 ORM 对象。"""

from collections.abc import Sequence

from platform_server.apps.collect.models import CollectPoint, CollectSource
from platform_server.apps.collect.protocols import (
    as_data_type,
    as_protocol,
    as_read_mode,
)
from platform_server.apps.collect.schemas import (
    BrowseItemOut,
    PlanPointOut,
    PlanSourceOut,
    PointOut,
    SourceOut,
)
from platform_server.apps.collect.services.command_bus import BrowseEntry
from timeseries import compose_node_key


def to_source_out(source: CollectSource, *, point_count: int) -> SourceOut:
    """一个数据源的对外形态。

    ⚠ 凭据只回一个「配没配过」的布尔：密文与明文都不出这个函数。
    Args: source, point_count。
    """
    return SourceOut(
        id=source.id,
        name=source.name,
        code=source.code,
        protocol=as_protocol(source.protocol),
        endpoint=source.endpoint,
        has_credential=source.credential_enc is not None,
        options_json=_text_options(source),
        read_mode=as_read_mode(source.read_mode),
        poll_interval_ms=source.poll_interval_ms,
        is_enabled=source.is_enabled,
        point_count=point_count,
        created_at=source.created_at,
        updated_at=source.updated_at,
    )


def to_point_out(point: CollectPoint) -> PointOut:
    """一个点位的对外形态，带算好的 `node_key`。

    Args: point。
    """
    return PointOut(
        id=point.id,
        source_id=point.source_id,
        node_key=compose_node_key(point.source_id, point.code),
        code=point.code,
        name=point.name,
        address=point.address,
        data_type=as_data_type(point.data_type),
        unit=point.unit,
        sampling_interval_ms=point.sampling_interval_ms,
        deadband=point.deadband,
        archive_enabled=point.archive_enabled,
        archive_max_interval_ms=point.archive_max_interval_ms,
        archive_retention_days=point.archive_retention_days,
        created_at=point.created_at,
        updated_at=point.updated_at,
    )


def to_browse_item_out(entry: BrowseEntry) -> BrowseItemOut:
    """一条浏览结果的对外形态。

    Args: entry。
    """
    return BrowseItemOut(
        address=entry.address,
        name=entry.name,
        has_children=entry.has_children,
        is_variable=entry.is_variable,
    )


def to_plan_source_out(
    source: CollectSource, *, points: Sequence[CollectPoint]
) -> PlanSourceOut:
    """一个数据源在采集计划里的形态。

    Args: source, points。
    """
    return PlanSourceOut(
        source_id=source.id,
        code=source.code,
        protocol=source.protocol,
        endpoint=source.endpoint,
        read_mode=source.read_mode,
        poll_interval_ms=source.poll_interval_ms,
        options=_text_options(source),
        points=[
            PlanPointOut(
                point_code=point.code,
                address=point.address,
                sampling_interval_ms=point.sampling_interval_ms,
                archive_enabled=point.archive_enabled,
                deadband=point.deadband,
                archive_max_interval_ms=point.archive_max_interval_ms,
            )
            for point in points
        ],
    )


def _text_options(source: CollectSource) -> dict[str, str]:
    """连接参数一律收成字符串键值。

    ⚠ 库里是 jsonb，可能被人手工塞进数字或对象；驱动只认字符串，静默传过去
    会在协议库里炸成一个与配置毫无关系的异常。
    Args: source。
    """
    return {str(key): str(value) for key, value in source.options_json.items()}
