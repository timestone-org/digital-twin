"""卡片样式库。事务边界在这一层：crud 不提交，api 不写业务。

一条样式是一整套**观感**：外壳（`chrome_json`）任何模块都吃，内芯
（`config_json`）是某一个模块自己的观感键。三条校验全部指到字段地 400——
外壳与内芯加起来六七十个键，回一句「样式不合法」等于让人二分法去找。

⚠ 内容键（标题、格、绑定、阈值规则）一个都不许进 `config_json`：样式套用是
顶层浅合并，写进去一个内容键就会在别人套用时把他配好的格整片抹掉。这条靠
「观感键 = 顶层键 − 清单声明的内容键」在下面守住。
"""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from lib.errors import FieldError
from lib.logging import get_logger
from lib.web import Page, PageParams
from platform_server.apps.dashboard.crud.card_style import card_style_crud
from platform_server.apps.dashboard.errors import (
    CardStyleInvalid,
    CardStyleNotFound,
)
from platform_server.apps.dashboard.models import CardStyle
from platform_server.apps.dashboard.schemas.card_style import (
    CardStyleCreateIn,
    CardStyleOut,
    CardStyleUpdateIn,
)
from platform_server.apps.dashboard.services.changes import given_changes
from platform_server.apps.dashboard.services.module_catalog import (
    ModuleCatalog,
)

_logger = get_logger("platform.dashboard.card_style")


async def list_card_styles(
    session: AsyncSession,
    *,
    module_type: str | None,
    page: PageParams,
) -> Page[CardStyleOut]:
    """样式列表，带两袋取值——样式墙每一格都要照着它渲染一张预览。

    Args: session, module_type, page。
    """
    rows, total = await card_style_crud.list_page(
        session,
        statement=card_style_crud.build_query(module_type=module_type),
        offset=page.offset,
        limit=page.size,
    )
    return Page[CardStyleOut](
        items=[to_card_style_out(row) for row in rows],
        page=page.page,
        size=page.size,
        total=total,
    )


async def get_card_style(
    session: AsyncSession, *, style_id: uuid.UUID
) -> CardStyleOut:
    """样式详情。

    Args: session, style_id。
    """
    return to_card_style_out(await require_card_style(session, style_id))


async def create_card_style(
    session: AsyncSession,
    *,
    payload: CardStyleCreateIn,
    catalog: ModuleCatalog,
) -> CardStyleOut:
    """存一条样式。`module_type` 留空即通用外壳样式。

    Args: session, payload, catalog。
    """
    check_style(
        module_type=payload.module_type,
        chrome_json=payload.chrome_json,
        config_json=payload.config_json,
        catalog=catalog,
    )
    style = CardStyle(
        name=payload.name,
        description=payload.description,
        module_type=payload.module_type,
        chrome_json=payload.chrome_json,
        config_json=payload.config_json,
        thumbnail=payload.thumbnail,
    )
    card_style_crud.add(session, style)
    await session.flush()
    _logger.info(
        "card_style_created",
        "卡片样式已创建",
        style_id=str(style.id),
        module_type=style.module_type,
    )
    return to_card_style_out(style)


async def update_card_style(
    session: AsyncSession,
    *,
    style_id: uuid.UUID,
    payload: CardStyleUpdateIn,
    catalog: ModuleCatalog,
) -> CardStyleOut:
    """改一条样式。缺省的字段不动，`module_type` 改不了。

    ⚠ 校验按**改完之后**的两袋值走：只改内芯时外壳仍要过一遍，否则一条早先
    存下的坏外壳会跟着这次保存一路溜过去。
    Args: session, style_id, payload, catalog。
    """
    style = await require_card_style(session, style_id)
    changes = given_changes(payload)
    check_style(
        module_type=style.module_type,
        chrome_json=changes.get("chrome_json", style.chrome_json),
        config_json=changes.get("config_json", style.config_json),
        catalog=catalog,
    )
    card_style_crud.apply_changes(style, changes)
    await session.flush()
    _logger.info("card_style_updated", "卡片样式已更新", style_id=str(style.id))
    return to_card_style_out(style)


async def delete_card_style(
    session: AsyncSession, *, style_id: uuid.UUID
) -> None:
    """删样式。已经套过它的节点不受影响——套用那一刻取值就落进节点了。

    Args: session, style_id。
    """
    style = await require_card_style(session, style_id)
    _logger.info("card_style_deleted", "卡片样式已删除", style_id=str(style.id))
    await card_style_crud.delete(session, style)


async def require_card_style(
    session: AsyncSession, style_id: uuid.UUID
) -> CardStyle:
    """取样式，取不到即 404。

    Args: session, style_id。
    """
    style = await card_style_crud.get(session, style_id)
    if style is None:
        raise CardStyleNotFound("卡片样式不存在")
    return style


def check_style(
    *,
    module_type: str | None,
    chrome_json: dict[str, object],
    config_json: dict[str, object],
    catalog: ModuleCatalog,
) -> None:
    """把一条样式对着模块清单查一遍，有问题就带着全部字段错一次性 400。

    Args: module_type, chrome_json, config_json, catalog。
    """
    is_known = module_type is None or module_type in catalog.known_types()
    details = (
        *_check_module_type(module_type, is_known=is_known),
        *_check_chrome(chrome_json, catalog=catalog),
        # ⚠ 类型都没认出来时不查内芯：观感键取自那个模块，认不出就是空集，
        # 一个键会连着报两条错，而真正要改的只有类型那一条
        *(
            _check_config(module_type, config_json, catalog=catalog)
            if is_known
            else ()
        ),
    )
    if details:
        raise CardStyleInvalid("样式与模块清单对不上", details=details)


def to_card_style_out(style: CardStyle) -> CardStyleOut:
    """样式的对外形态。

    Args: style。
    """
    return CardStyleOut.model_validate(style)


def _check_module_type(
    module_type: str | None, *, is_known: bool
) -> tuple[FieldError, ...]:
    if is_known:
        return ()
    return (
        FieldError(
            field="module_type",
            code="module_type_unknown",
            message=f"模块类型未注册：{module_type}",
        ),
    )


def _check_chrome(
    chrome_json: dict[str, object], *, catalog: ModuleCatalog
) -> tuple[FieldError, ...]:
    """外壳的键必须都在清单的外壳词汇表里。

    ⚠ 词汇表整段缺失时这里会把**每一个**键都拒掉，那是故意的：产物少了
    `chrome_keys` 就等于服务端没有依据，此时放行只会让写错的键静默存进库。
    Args: chrome_json, catalog。
    """
    allowed = catalog.chrome_key_names()
    return tuple(
        FieldError(
            field=f"chrome_json.{key}",
            code="chrome_key_unknown",
            message=f"外壳词汇表里没有这个键：{key}",
        )
        for key in sorted(chrome_json)
        if key not in allowed
    )


def _check_config(
    module_type: str | None,
    config_json: dict[str, object],
    *,
    catalog: ModuleCatalog,
) -> tuple[FieldError, ...]:
    """内芯的键必须都是该模块的观感键；通用样式则一个都不许有。

    ⚠ 外壳那一段（`__cardStyle`）同样会被这里拒掉，而且应该被拒：它是外壳，
    归 `chrome_json`。清单里的内置预设把两者混在一袋里，照抄一套预设去建样式
    时必须先把它拆出来，否则套用时会有两份外壳互相盖。
    Args: module_type, config_json, catalog。
    """
    if module_type is None:
        if not config_json:
            return ()
        return (
            FieldError(
                field="config_json",
                code="generic_style_carries_config",
                message="通用外壳样式不带内芯：要存内芯先选一个模块类型",
            ),
        )
    allowed = catalog.look_keys(module_type)
    return tuple(
        FieldError(
            field=f"config_json.{key}",
            code="config_key_not_a_look_key",
            message=f"这不是 {module_type} 的观感键：{key}",
        )
        for key in sorted(config_json)
        if key not in allowed
    )
