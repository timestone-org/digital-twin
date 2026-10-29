"""将授权 BDM 目录映射成算子选择器可使用的分页目录。"""

from pydantic import JsonValue

from lib.errors import ValidationFailed
from platform_server.apps.modeling.operators.bdm import (
    MAX_FORMULAS,
    MAX_IDENTIFIERS,
    MAX_ROWS,
    MINUTE_INTERVALS,
)
from platform_server.apps.modeling.schemas.bdm import (
    BdmCatalogItemOut,
    BdmCatalogOut,
    BdmCatalogQuery,
    BdmCatalogWire,
    BdmSystemsOut,
    BdmSystemsWire,
)
from platform_server.apps.modeling.schemas.bdm_discovery import (
    BdmCapabilitiesOut,
    BdmIndicatorOut,
    BdmIndicatorPageWire,
    BdmIndicatorQuery,
    BdmIndicatorSourceOut,
    BdmIndicatorsOut,
)
from platform_server.apps.modeling.services.bdm_client import (
    BdmClient,
    BdmConnection,
    BdmReadFailed,
)


def capabilities(connection: BdmConnection | None) -> BdmCapabilitiesOut:
    """返回本地配置与算子边界，不探测上游连通性。Args: connection。"""
    return BdmCapabilitiesOut(
        is_configured=connection is not None,
        timezone=connection.timezone if connection else None,
        minute_intervals=list(MINUTE_INTERVALS),
        max_identifiers=MAX_IDENTIFIERS,
        max_formula_identifiers=MAX_FORMULAS,
        max_rows=MAX_ROWS,
        load_timeout_s=connection.load_timeout_s if connection else None,
    )


async def read_indicators(
    connection: BdmConnection | None, query: BdmIndicatorQuery
) -> BdmIndicatorsOut:
    """读取指标的可选属性绑定。Args: connection, query。"""
    if connection is None:
        raise BdmReadFailed("BDM 接口未启用，请联系管理员配置连接")
    params: dict[str, str | int] = {"page": query.page, "pageSize": query.size}
    if query.code:
        params["code"] = query.code
    async with BdmClient(connection) as client:
        result = await client.read(
            "/indicators", BdmIndicatorPageWire, params=params
        )
    return BdmIndicatorsOut(
        total=result.total,
        page=result.page,
        size=result.page_size,
        items=[
            BdmIndicatorOut(
                id=item.id,
                code=item.code,
                name=item.name,
                unit=item.unit,
                sources=[
                    BdmIndicatorSourceOut(
                        source_type=source.source_type,
                        source_id=source.source_id,
                        source_property=source.source_property,
                        alias=source.alias,
                        unit=source.unit,
                        is_selectable=source.source_type == "unitProperty"
                        and bool(source.source_id and source.source_id.strip()),
                    )
                    for source in item.sources
                ],
            )
            for item in result.items
        ],
    )


async def read_catalog(
    connection: BdmConnection | None, query: BdmCatalogQuery
) -> BdmCatalogOut:
    """获取单页目录，不扫描全库。Args: connection, query。"""
    if connection is None:
        raise BdmReadFailed("BDM 接口未启用，请联系管理员配置连接")
    params = _params(query)
    async with BdmClient(connection) as client:
        result = await client.read(
            "/points" if query.kind == "point" else "/catalog",
            BdmCatalogWire,
            params=params,
        )
    if query.system and result.system_filter_available is False:
        raise ValidationFailed("上游目录不支持系统过滤，请清空系统条件后重试")
    return BdmCatalogOut(
        kind=query.kind,
        total=result.total,
        page=result.page,
        size=result.page_size,
        system_filter_available=result.system_filter_available,
        items=[_item(item, query.kind) for item in result.items],
    )


async def read_systems(connection: BdmConnection | None) -> BdmSystemsOut:
    """读取点位系统选项及筛选能力。Args: connection。"""
    if connection is None:
        raise BdmReadFailed("BDM 接口未启用，请联系管理员配置连接")
    async with BdmClient(connection) as client:
        result = await client.read("/points/systems", BdmSystemsWire)
    return BdmSystemsOut(
        items=result.items,
        system_filter_available=result.system_filter_available,
    )


def _params(query: BdmCatalogQuery) -> dict[str, str | int]:
    if query.kind != "point" and (query.keyword or query.code):
        raise ValidationFailed(
            "属性与公式目录不支持关键词或编码过滤，请翻页或直接填写标识"
        )
    if query.kind == "formula" and query.system:
        raise ValidationFailed("公式目录不支持系统过滤")
    if query.kind != "point" and query.should_include_unqueryable:
        raise ValidationFailed("仅点位目录支持查询不可取数配置")
    params: dict[str, str | int] = {"page": query.page, "pageSize": query.size}
    if query.kind != "point":
        params["kind"] = query.kind
    if query.should_include_unqueryable:
        params["includeUnqueryable"] = "true"
    params.update(
        {
            key: value
            for key, value in (
                ("name", query.name),
                ("keyword", query.keyword),
                ("code", query.code),
                ("system", query.system),
            )
            if value
        }
    )
    return params


def _text(item: dict[str, JsonValue], key: str) -> str:
    value = item.get(key)
    if value is None:
        return ""
    if not isinstance(value, str):
        raise BdmReadFailed("BDM 目录字段格式不符合契约")
    return value


def _item(item: dict[str, JsonValue], kind: str) -> BdmCatalogItemOut:
    key = (
        "pointId"
        if kind == "point"
        else "propertyId" if kind == "raw" else "code"
    )
    identifier = _text(item, key)
    if not identifier:
        raise BdmReadFailed("BDM 目录缺少可用标识")
    name = (
        " · ".join(
            filter(None, (_text(item, "nodeName"), _text(item, "propertyName")))
        )
        if kind == "raw"
        else _text(item, "name")
    )
    available = item.get("historyAvailable")
    if available is not None and not isinstance(available, bool):
        raise BdmReadFailed("BDM 目录的历史可用标记格式错误")
    return BdmCatalogItemOut(
        identifier=identifier,
        code=_text(item, "code") or identifier,
        name=name or identifier,
        system=_text(item, "system" if kind == "point" else "nodeSystem")
        or None,
        history_available=available,
        table_type=_text(item, "tableType") or None,
        unit=_text(item, "unit") or None,
    )
