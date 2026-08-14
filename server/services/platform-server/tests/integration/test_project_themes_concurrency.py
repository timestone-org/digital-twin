"""两个人同时给一个项目加主题时，谁的那套都不该被悄悄盖掉。

主题整组存在一个 JSONB 数组里，增删改因此都是「整组读 → 改 → 整组写回」。
⚠ 这条丢更新只在两个事务**真的交错**时才出现：两边各读到同一份旧数组、各写回
自己那一份，后写的把先写的整个盖掉，而两个请求都收到 201。故这条用例必须打
真库、真开两条连接——`app_context` 那条会话整场包在一个回滚事务里且只有一条
连接，在它上面串行跑一遍永远是绿的。
"""

import asyncio
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass

import pytest
from sqlalchemy import delete

from lib.db import Database
from platform_server.apps.dashboard.models import DashboardProject
from platform_server.apps.dashboard.schemas.theme import ThemeCreateIn
from platform_server.apps.dashboard.services import theme_service
from platform_server.settings import DB_SCHEMA, Settings

pytestmark = pytest.mark.requires_postgres

# 两条事务互相等锁的上限。超了就是锁没放开，让用例红而不是把套件挂住
LOCK_WAIT_TIMEOUT_S = 30.0


@dataclass(frozen=True)
class LiveProject:
    """一个真提交进库的项目，配一条独立连接池。"""

    database: Database
    project_id: uuid.UUID


@pytest.fixture
async def live_project(settings: Settings) -> AsyncIterator[LiveProject]:
    """建一个真提交的项目，用完连项目带主题一起删掉。

    Args: settings。
    """
    database = Database(dsn=settings.dsn(), search_path=DB_SCHEMA)
    project = DashboardProject(name="并发主题")
    async with database.session() as session:
        session.add(project)
        await session.flush()
        project_id = project.id
    yield LiveProject(database=database, project_id=project_id)
    async with database.session() as session:
        await session.execute(
            delete(DashboardProject).where(DashboardProject.id == project_id)
        )
    await database.dispose()


async def add_theme(live: LiveProject, name: str) -> None:
    """在自己的事务里加一套主题。

    Args: live, name。
    """
    async with live.database.session() as session:
        await theme_service.create_theme(
            session,
            project_id=live.project_id,
            payload=ThemeCreateIn(name=name, mode="dark", tokens={}),
        )


async def names_in(live: LiveProject) -> set[str]:
    """库里此刻有哪几套主题。

    Args: live。
    """
    async with live.database.session() as session:
        themes = await theme_service.list_themes(
            session, project_id=live.project_id
        )
    return {theme.name for theme in themes}


@pytest.mark.usefixtures("app_context")
async def test_two_themes_added_at_the_same_time_both_survive(
    live_project: LiveProject,
) -> None:
    # `app_context` 只用来沿用它「连不到 Postgres 就跳过」的判断
    await asyncio.wait_for(
        asyncio.gather(
            add_theme(live_project, "甲"), add_theme(live_project, "乙")
        ),
        timeout=LOCK_WAIT_TIMEOUT_S,
    )
    assert await names_in(live_project) == {"甲", "乙"}


@pytest.mark.usefixtures("app_context")
async def test_a_crowd_adding_themes_at_once_loses_none_of_them(
    live_project: LiveProject,
) -> None:
    wanted = {f"配色{index}" for index in range(6)}
    await asyncio.wait_for(
        asyncio.gather(*(add_theme(live_project, name) for name in wanted)),
        timeout=LOCK_WAIT_TIMEOUT_S,
    )
    assert await names_in(live_project) == wanted
