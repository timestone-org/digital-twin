"""项目自定义主题的增删改查。事务边界在这一层：crud 不提交，api 不写业务。

主题整组存在 `dashboard_projects.custom_themes_json` 这一个 JSONB 数组里，
故每一次增删改都是「整组读 → 改一项 → 整组写回」。⚠ 这三步必须锁着项目行
在**同一个事务**里做，否则两个人同时加主题会各自读到同一份旧数组、各自写回
自己那一份，后写的把先写的整个盖掉——两边都收到 200，谁也不知道丢了一套。
"""

import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from lib.logging import get_logger
from lib.utils.ids import uuid7
from platform_server.apps.dashboard.errors import (
    ProjectNotFound,
    ThemeNotFound,
)
from platform_server.apps.dashboard.models import DashboardProject
from platform_server.apps.dashboard.schemas.theme import (
    ThemeCreateIn,
    ThemeOut,
    ThemeUpdateIn,
)
from platform_server.apps.dashboard.services.changes import given_changes
from platform_server.apps.dashboard.services.project_service import (
    require_project,
)

_logger = get_logger("platform.dashboard.theme")


async def list_themes(
    session: AsyncSession, *, project_id: uuid.UUID
) -> list[ThemeOut]:
    """列出项目下全部自定义主题，顺序即存储顺序。

    Args: session, project_id。
    """
    project = await require_project(session, project_id)
    return decode_themes(project.custom_themes_json)


async def create_theme(
    session: AsyncSession, *, project_id: uuid.UUID, payload: ThemeCreateIn
) -> ThemeOut:
    """新建一套自定义主题，追加在数组末尾。

    Args: session, project_id, payload。
    """
    project = await locked_project(session, project_id)
    created = ThemeOut(
        id=uuid7(),
        name=payload.name,
        mode=payload.mode,
        tokens=payload.tokens,
    )
    themes = decode_themes(project.custom_themes_json)
    store_themes(project, [*themes, created])
    await session.flush()
    _logger.info(
        "project_theme_created",
        "项目主题已新增",
        project_id=str(project_id),
        theme_id=str(created.id),
    )
    return created


async def update_theme(
    session: AsyncSession,
    *,
    project_id: uuid.UUID,
    theme_id: uuid.UUID,
    payload: ThemeUpdateIn,
) -> ThemeOut:
    """改一套自定义主题。缺省的字段不动。

    Args: session, project_id, theme_id, payload。
    """
    project = await locked_project(session, project_id)
    themes = decode_themes(project.custom_themes_json)
    position = index_of(themes, theme_id)
    updated = themes[position].model_copy(update=given_changes(payload))
    themes[position] = updated
    store_themes(project, themes)
    await session.flush()
    _logger.info(
        "project_theme_updated",
        "项目主题已更新",
        project_id=str(project_id),
        theme_id=str(theme_id),
    )
    return updated


async def delete_theme(
    session: AsyncSession, *, project_id: uuid.UUID, theme_id: uuid.UUID
) -> None:
    """删一套自定义主题。

    ⚠ 引用这套主题的大屏一张都不动：它们 resolve 时自然回退到项目默认或内置
    主题。联动改屏才是危险的——删一套配色不该悄悄改写别人正在展播的画面。
    Args: session, project_id, theme_id。
    """
    project = await locked_project(session, project_id)
    themes = decode_themes(project.custom_themes_json)
    del themes[index_of(themes, theme_id)]
    store_themes(project, themes)
    await session.flush()
    _logger.info(
        "project_theme_deleted",
        "项目主题已删除",
        project_id=str(project_id),
        theme_id=str(theme_id),
    )


async def locked_project(
    session: AsyncSession, project_id: uuid.UUID
) -> DashboardProject:
    """取项目并锁住这一行，直到本事务结束。取不到即 404。

    ⚠ `populate_existing` 不能省：同一事务里若别处已经加载过这个项目，
    SQLAlchemy 会把身份映射里那份**加锁之前**的属性原样交回来，锁是拿到了，
    读到的数组却还是旧的，于是照样覆盖。
    Args: session, project_id。
    """
    rows = await session.execute(
        select(DashboardProject)
        .where(DashboardProject.id == project_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    project = rows.scalar_one_or_none()
    if project is None:
        raise ProjectNotFound("项目不存在")
    return project


def decode_themes(raw: Sequence[Any]) -> list[ThemeOut]:
    """把 JSONB 数组收敛成主题列表。

    ⚠ `Any` 只在这一处：JSONB 出来就是无类型的，故进门第一件事就是逐项过
    模型，后面的代码再也拿不到裸 JSON。
    Args: raw。
    """
    return [ThemeOut.model_validate(item) for item in raw]


def store_themes(project: DashboardProject, themes: Sequence[ThemeOut]) -> None:
    """整组写回项目。

    ⚠ 必须整个换一个新列表：JSONB 列上没有变更跟踪，就地 `append` 或改元素
    SQLAlchemy 一律看不见，flush 时一条 UPDATE 都不发，接口却照样回 200。
    Args: project, themes。
    """
    project.custom_themes_json = [
        theme.model_dump(mode="json") for theme in themes
    ]


def index_of(themes: Sequence[ThemeOut], theme_id: uuid.UUID) -> int:
    """主题在数组里的下标，找不到即 404。

    Args: themes, theme_id。
    """
    for position, theme in enumerate(themes):
        if theme.id == theme_id:
            return position
    raise ThemeNotFound("项目下没有这个自定义主题")
