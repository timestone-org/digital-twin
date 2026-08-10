"""闸 1 的服务端实现：边缘子请求打进来的鉴权端点。

⚠ **口径是先认证、再查规则。**「查不到权限码」绝不等于「匿名放行」——
空 `permission_codes` 的语义是「任意已登录用户放行」，匿名可达性由边缘的
免认证 location 保证。把规则判定提到认证之前会让本端点变成可被任意路径
匿名探测的 oracle，且 200 时不下发身份头会让上游拿到空身份。
"""

import uuid
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from auth_server.apps.auth.errors import (
    AccountDisabled,
    PermissionRequired,
    TokenInvalid,
)
from auth_server.apps.auth.services.identity import (
    Identity,
    load_identity_by_id,
)
from auth_server.apps.auth.services.matching import Decision, decide
from auth_server.apps.auth.services.route_rule_service import (
    RouteRuleCache,
)
from auth_server.apps.auth.services.token_service import (
    TokenService,
    parse_bearer,
)
from lib.auth import (
    MAX_PERMISSION_HEADER_BYTES,
    encode_identity,
    encode_permissions,
    sign_context,
)
from lib.logging import get_logger
from lib.utils.timeutils import Clock

_logger = get_logger("auth.verify")

HEADER_USER_ID = "X-Auth-User-Id"
HEADER_USERNAME = "X-Auth-Username"
HEADER_ROLE = "X-Auth-Role"
HEADER_PERMISSIONS = "X-Auth-Permissions"
HEADER_TRUNCATED = "X-Auth-Permissions-Truncated"
HEADER_EXPIRES = "X-Auth-Exp"
HEADER_SIGNATURE = "X-Auth-Sig"


@dataclass(frozen=True)
class VerifyService:
    """边缘鉴权。签名把「权限集合」从客户端可控输入变回服务端断言。"""

    tokens: TokenService
    rules: RouteRuleCache
    signing_secret: str
    header_ttl_s: int
    clock: Clock

    async def verify(
        self,
        session: AsyncSession,
        *,
        authorization: str | None,
        path: str,
        method: str,
    ) -> dict[str, str]:
        """认证 → 鉴权 → 下发签名身份头。任一步不过即抛。

        Args: session, authorization, path, method。
        """
        identity = await self._authenticate(session, authorization)
        decision = decide(
            await self.rules.rules(session),
            path=path,
            method=method,
            held_codes=identity.codes,
        )
        if not decision.allowed:
            self._log_denied(identity, path, method, decision)
            raise PermissionRequired("没有该操作的权限")
        return self.build_headers(identity)

    def build_headers(self, identity: Identity) -> dict[str, str]:
        """构造签名的身份与权限头。

        Args: identity。
        """
        user_id = str(identity.user.id)
        role = encode_identity(identity.user.role.name)
        permissions = encode_permissions(identity.codes)
        expires_at = int(self.clock().timestamp()) + self.header_ttl_s
        signature = sign_context(
            self.signing_secret,
            user_id=user_id,
            role=role,
            permissions_b64=permissions,
            expires_at=expires_at,
        )
        headers = {
            HEADER_USER_ID: user_id,
            HEADER_USERNAME: encode_identity(identity.user.username),
            HEADER_ROLE: role,
            HEADER_EXPIRES: str(expires_at),
            HEADER_SIGNATURE: signature,
        }
        headers.update(_permission_header(permissions, user_id))
        return headers

    async def _authenticate(
        self, session: AsyncSession, authorization: str | None
    ) -> Identity:
        token = parse_bearer(authorization)
        if token is None:
            raise TokenInvalid("未提供访问令牌")
        claims = self.tokens.decode_access(token)
        identity = await load_identity_by_id(session, _subject(claims.subject))
        if identity is None:
            raise TokenInvalid("令牌对应的账号不存在")
        if not identity.user.is_active:
            raise AccountDisabled("账号已停用")
        return identity

    @staticmethod
    def _log_denied(
        identity: Identity, path: str, method: str, decision: Decision
    ) -> None:
        _logger.info(
            "authorization_denied",
            "闸 1 拒绝",
            user_id=str(identity.user.id),
            path=path,
            http_method=method,
            reason=str(decision.reason),
            required=sorted(decision.required_codes),
        )


def _permission_header(permissions: str, user_id: str) -> dict[str, str]:
    if len(permissions.encode("ascii")) > MAX_PERMISSION_HEADER_BYTES:
        _logger.warning(
            "permission_header_truncated",
            "权限头超出上限，改发降级标记",
            user_id=user_id,
            size=len(permissions),
        )
        return {HEADER_TRUNCATED: "1"}
    return {HEADER_PERMISSIONS: permissions}


def _subject(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError as error:
        raise TokenInvalid("令牌主体不是合法标识") from error
