"""全局 fixture。

本服务的能力面与技能装配都不碰数据库，故这一层的用例不需要真库；
碰库的用例自己挂 `requires_postgres`。

⚠ 用例里不要 `from tests.conftest import ...`：workspace 里每个服务都有一个
顶层 `tests` 包，那条 import 会解析到别的服务的 conftest。
"""

import uuid
from collections.abc import AsyncIterator, Callable, Iterable

import httpx
import pytest
from pydantic import SecretStr

from ai_assistant.app import build_app
from ai_assistant.apps.chat.catalog import ASSISTANT_MANAGE, ASSISTANT_USE
from ai_assistant.settings import Settings
from lib.auth import (
    SignedContext,
    encode_identity,
    encode_permissions,
    sign_context,
)
from lib.logging import configure_logging
from lib.utils.timeutils import utcnow

# 身份头的存活时长，取值本身不参与断言
HEADER_TTL_S = 900
FULL_CODES = (ASSISTANT_USE, ASSISTANT_MANAGE)
# 占位取值：本层用例一个都不连
PLACEHOLDER = "ai-assistant-test"

HeaderFactory = Callable[..., dict[str, str]]


@pytest.fixture(scope="session", autouse=True)
def _logging() -> None:
    configure_logging(
        service="ai-assistant", role="test", instance="test", log_format="text"
    )


@pytest.fixture
def settings() -> Settings:
    """一份不连任何依赖的配置。模型默认关着。"""
    return Settings(
        postgres_host=PLACEHOLDER,
        postgres_user=PLACEHOLDER,
        postgres_password=SecretStr(PLACEHOLDER),
        postgres_db=PLACEHOLDER,
        redis_host=PLACEHOLDER,
        edge_signing_secret=SecretStr("s" * 32),
        edge_service_key=SecretStr("k" * 32),
    )


@pytest.fixture
def sign(settings: Settings) -> HeaderFactory:
    """造一组边缘签名身份头。

    Args: settings。
    """
    secret = settings.edge_signing_secret.get_secret_value()

    def make(
        codes: Iterable[str] = FULL_CODES,
        *,
        lifetime_s: int = HEADER_TTL_S,
        role: str = "admin",
    ) -> dict[str, str]:
        user_id = str(uuid.uuid4())
        encoded_role = encode_identity(role)
        permissions = encode_permissions(codes)
        expires_at = int(utcnow().timestamp()) + lifetime_s
        context = SignedContext(
            user_id=user_id,
            role=encoded_role,
            permissions_b64=permissions,
            expires_at=expires_at,
        )
        return {
            "X-Auth-User-Id": user_id,
            "X-Auth-Username": encode_identity("测试员"),
            "X-Auth-Role": encoded_role,
            "X-Auth-Permissions": permissions,
            "X-Auth-Exp": str(expires_at),
            "X-Auth-Sig": sign_context(secret, context),
        }

    return make


@pytest.fixture
async def app_client(
    settings: Settings, sign: HeaderFactory
) -> AsyncIterator[httpx.AsyncClient]:
    """整装应用的客户端，默认带全权身份头。

    Args: settings, sign。
    """
    transport = httpx.ASGITransport(app=build_app(settings))
    async with httpx.AsyncClient(
        transport=transport, base_url="http://assistant-test", timeout=10
    ) as client:
        client.headers.update(sign())
        yield client
