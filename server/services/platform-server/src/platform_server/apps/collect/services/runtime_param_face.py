"""采集/归档运行参数的写编排：scope 校验 → 落覆盖行 → **就地提交**。

事务边界在这一层：路由函数只做取参 → 调这里 → 通知计划变更 → 包封。
⚠ 提交必须在通知之前（与 source_service 同一条理由）：FastAPI 把「发响应」
放在 yield 依赖的退出栈里面，不就地提交，collector 收到通知时重拉到的还是
旧覆盖值，而它不会再拉第二次。
"""

from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.runtime_params.services import (
    COLLECT_SCOPE,
    RuntimeParamOut,
    RuntimeParamWriteIn,
    param_service,
)
from platform_server.settings import Settings


async def read_items(
    session: AsyncSession, *, settings: Settings, section: str | None
) -> list[RuntimeParamOut]:
    """列出采集与归档两组运行参数。给了 `section` 就只回那一组。

    Args: session, settings, section。
    """
    return await param_service.read_items(
        session, settings=settings, section=section, scope=COLLECT_SCOPE
    )


async def write_section(
    session: AsyncSession,
    *,
    settings: Settings,
    section: str,
    payload: RuntimeParamWriteIn,
    actor: str,
) -> list[RuntimeParamOut]:
    """改一个分组里的若干项并就地提交。

    Args: session, settings, section, payload, actor。
    """
    param_service.require_in_scope(section, COLLECT_SCOPE)
    state = await param_service.write_section(
        session,
        settings=settings,
        section=section,
        payload=payload,
        actor=actor,
    )
    await session.commit()
    return state


async def reset_section(
    session: AsyncSession, *, settings: Settings, section: str, actor: str
) -> list[RuntimeParamOut]:
    """删掉该分组的覆盖行并就地提交，此后重新跟随采集器的环境变量。

    Args: session, settings, section, actor。
    """
    param_service.require_in_scope(section, COLLECT_SCOPE)
    state = await param_service.reset_section(
        session, settings=settings, section=section, actor=actor
    )
    await session.commit()
    return state
