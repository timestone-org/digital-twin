"""闸 2 的依赖注入件：读边缘注入的签名身份头，按权限码放行或拒绝。

闸 1（路由规则）在边缘执行，绕过边缘直连端口时它不生效；闸 2 贴着代码，
**任何路径都生效**。两者对同一端点的权限码必须一致，由各服务的契约测试锁死。

⚠ 本层不自己校验令牌：它读的是边缘调过认证之后注入的**签名**身份头。签名是
关键——没有它，任何人直接 `curl -H "X-Auth-Permissions: …"` 就是超管。
"""

import hmac
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request

from lib.auth.context import CallerContext
from lib.auth.edge_headers import decode_caller
from lib.errors import PermissionDenied, Unauthenticated
from lib.utils.timeutils import utcnow

# 端点声明自己要的权限码，契约测试遍历路由时读它
REQUIRED_CODES_ATTR = "__auth_required_codes__"
REQUIRED_MODE_ATTR = "__auth_required_mode__"

MODE_ALL = "all"
MODE_ANY = "any"

# 从请求上取一个密钥。真实现读组合根里的配置，测试可以直接给个常量
type SecretReader = Callable[[Request], str]
# 把「卡在哪一步」翻成给用户看的一句话
type MessageOf = Callable[[str], str]

type CallerDependency = Callable[[Request], Awaitable[CallerContext]]
type ServiceKeyDependency = Callable[[Request], Awaitable[None]]
type PermissionDependency = Callable[[CallerContext], Awaitable[CallerContext]]

_DEFAULT_MESSAGE = "身份信息缺失或已过期，请重新登录"


def _default_message_of(reason: str) -> str:
    """默认只给一句话——不区分卡在哪一步。

    Args: reason。
    """
    del reason
    return _DEFAULT_MESSAGE


@dataclass(frozen=True)
class AuthDeps:
    """一个服务的闸 2 三件套。由 `build_auth_deps` 在组合根旁边造一次。"""

    caller: CallerDependency
    service_key: ServiceKeyDependency
    require: Callable[..., PermissionDependency]


def build_auth_deps(
    *,
    signing_secret_of: SecretReader,
    service_key_of: SecretReader,
    message_of: MessageOf = _default_message_of,
) -> AuthDeps:
    """按本服务的取密钥方式造出闸 2 的三个依赖件。

    Args: signing_secret_of, service_key_of, message_of。
    """
    caller = _build_caller(signing_secret_of, message_of)
    return AuthDeps(
        caller=caller,
        service_key=_build_service_key(service_key_of),
        require=_build_require(caller),
    )


def _build_caller(
    signing_secret_of: SecretReader, message_of: MessageOf
) -> CallerDependency:
    async def get_caller(request: Request) -> CallerContext:
        """从边缘注入的签名身份头解出调用者。验不过一律 401。

        ⚠ 直接读 `request.headers` 而不是声明成七个 Header 形参：那些头是
        **边缘注入**的，写进 OpenAPI 会诱导客户端自己发一份伪造的。
        Args: request。
        """
        outcome = decode_caller(
            request.headers,
            signing_secret=signing_secret_of(request),
            now=utcnow(),
        )
        if outcome.caller is None:
            raise Unauthenticated(message_of(outcome.reason))
        return outcome.caller

    return get_caller


def _build_service_key(service_key_of: SecretReader) -> ServiceKeyDependency:
    async def require_service_key(request: Request) -> None:
        """内部端点的服务级密钥。⚠ 未配置或不符一律拒绝，不是放行。

        Args: request。
        """
        expected = service_key_of(request)
        given = request.headers.get("X-Service-Key")
        if not expected or not given:
            raise Unauthenticated("服务级密钥缺失")
        if not hmac.compare_digest(expected, given):
            raise Unauthenticated("服务级密钥不符")

    return require_service_key


def _build_require(
    caller: CallerDependency,
) -> Callable[..., PermissionDependency]:
    def require(*codes: str, mode: str = MODE_ALL) -> PermissionDependency:
        """闸 2：要求调用者持有给定权限码。

        Args: codes, mode（`all` 全持有 / `any` 任一即可）。
        """
        required = frozenset(codes)

        async def dependency(
            context: Annotated[CallerContext, Depends(caller)],
        ) -> CallerContext:
            satisfied = (
                context.has_any(required)
                if mode == MODE_ANY
                else context.has_all(required)
            )
            if not satisfied:
                raise PermissionDenied("没有该操作的权限")
            return context

        setattr(dependency, REQUIRED_CODES_ATTR, required)
        setattr(dependency, REQUIRED_MODE_ATTR, mode)
        return dependency

    return require
