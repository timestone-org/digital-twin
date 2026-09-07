"""会话面：登录、刷新、登出、自助注册与嵌入交换。

⚠ 登录、刷新、登出与注册的匿名可达性由边缘免认证 location 保证；API 密钥
交换仍走边缘鉴权。规则表里的空码只表示「任意已认证调用者放行」。
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Header, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.deps import get_container, get_session
from auth_server.apps.auth.errors import TokenInvalid
from auth_server.apps.auth.schemas import (
    EmbedSessionOut,
    LoginIn,
    RefreshIn,
    RegistrationIn,
    SessionOut,
    UserDetailOut,
)
from auth_server.apps.auth.services import looks_like_api_key
from auth_server.apps.auth.services.token_service import parse_bearer
from auth_server.container import Container
from auth_server.settings import API_PREFIX
from lib.web import ApiResponse, ok

router = APIRouter(prefix=API_PREFIX, tags=["session"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
ContainerDep = Annotated[Container, Depends(get_container)]
AuthorizationHeader = Annotated[str | None, Header()]


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
    "/sessions:from-api-key",
    response_model=ApiResponse[EmbedSessionOut],
    summary="用 API 密钥创建嵌入会话",
)
async def create_session_from_api_key(
    session: SessionDep,
    container: ContainerDep,
    authorization: AuthorizationHeader = None,
) -> ApiResponse[EmbedSessionOut]:
    """API 密钥换短期 access token，不签发 refresh token。

    Args: session, container, authorization。
    """
    api_key = parse_bearer(authorization)
    if api_key is None or not looks_like_api_key(api_key):
        raise TokenInvalid("API 密钥无效或已失效")
    result = await container.auth.create_embed_session(session, api_key=api_key)
    return ok(result, message="嵌入会话已创建")


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
