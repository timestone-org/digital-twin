"""会话面：登录、刷新、登出、自助注册。

⚠ 这几条的匿名可达性由边缘的免认证 location 保证；规则表里的空
`permission_codes` 只表示「任意已登录用户放行」。
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.deps import get_container, get_session
from auth_server.apps.auth.schemas import (
    LoginIn,
    RefreshIn,
    RegistrationIn,
    SessionOut,
    UserDetailOut,
)
from auth_server.container import Container
from auth_server.settings import API_PREFIX
from lib.web import ApiResponse, ok

router = APIRouter(prefix=API_PREFIX, tags=["session"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ContainerDep = Annotated[Container, Depends(get_container)]


@router.post(
    "/sessions",
    response_model=ApiResponse[SessionOut],
    status_code=status.HTTP_201_CREATED,
    summary="登录并创建会话",
)
async def create_session(
    payload: LoginIn,
    session: SessionDep,
    container: ContainerDep,
) -> ApiResponse[SessionOut]:
    """账号口令登录。

    Args: payload, session, container。
    """
    result = await container.auth.login(
        session, login=payload.username, password=payload.password
    )
    return ok(result, message="登录成功")


@router.post(
    "/sessions:refresh",
    response_model=ApiResponse[SessionOut],
    summary="轮换令牌",
)
async def refresh_session(
    payload: RefreshIn,
    session: SessionDep,
    container: ContainerDep,
) -> ApiResponse[SessionOut]:
    """用刷新令牌换一对新令牌，旧刷新令牌立即失效。

    Args: payload, session, container。
    """
    result = await container.auth.refresh(
        session, refresh_token=payload.refresh_token
    )
    return ok(result, message="令牌已刷新")


@router.post(
    "/sessions:revoke",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="登出",
)
async def revoke_session(
    payload: RefreshIn, container: ContainerDep
) -> Response:
    """吊销刷新令牌。重复调用无副作用。

    Args: payload, container。
    """
    await container.auth.logout(refresh_token=payload.refresh_token)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/registrations",
    response_model=ApiResponse[UserDetailOut],
    status_code=status.HTTP_201_CREATED,
    summary="自助注册",
)
async def register(
    payload: RegistrationIn,
    session: SessionDep,
    container: ContainerDep,
) -> ApiResponse[UserDetailOut]:
    """自助注册。未开放时返回 403。

    Args: payload, session, container。
    """
    created = await container.auth.register(session, payload=payload)
    return ok(created, message="注册成功")
