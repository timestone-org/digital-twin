"""将授权 BDM 目录映射成算子选择器可使用的分页目录。"""

from pydantic import JsonValue

from lib.errors import ValidationFailed
from platform_server.apps.modeling.schemas.bdm import (
    BdmCatalogItemOut,
    BdmCatalogOut,
    BdmCatalogQuery,
    BdmCatalogWire,
)
from platform_server.apps.modeling.services.bdm_client import (
    BdmClient,
    BdmConnection,
    BdmReadFailed,
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


def _params(query: BdmCatalogQuery) -> dict[str, str | int]:
    if query.kind != "point" and (query.keyword or query.code):
        raise ValidationFailed(
            "属性与公式目录不支持关键词或编码过滤，请翻页或直接填写标识"
        )
    if query.kind == "formula" and query.system:
        raise ValidationFailed("公式目录不支持系统过滤")
    params: dict[str, str | int] = {"page": query.page, "pageSize": query.size}
    if query.kind != "point":
        params["kind"] = query.kind
    params.update(
        {
            key: value
            for key, value in (
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
    )
