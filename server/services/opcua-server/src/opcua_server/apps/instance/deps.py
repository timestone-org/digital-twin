"""FastAPI 依赖注入件 —— 闸 2 与本服务自己的那几件。

闸 1（路由规则）在边缘执行，绕过边缘直连端口时它不生效；闸 2 贴着代码，
**任何路径都生效**。两者对同一端点的权限码必须一致，由契约测试锁死。
算法与装配在 `lib.web.authdeps`，`platform-server` 用的是同一份。

⚠ 本服务与 auth-server 的认证方式相反：auth-server 读 Bearer 令牌（它自己
就是发令牌的人），本服务读边缘注入的 `X-Auth-*` 签名头，用
`edge_signing_secret` 验签——头可以伪造，签名不能。

⚠ 这里没有请求级的 session 依赖。本服务的动作端点要在事务外做外部 IO
（起停实例、写节点值），事务边界因此归 service 层自己持有，见
`docs/agents/database-standard.md`「禁事务内做外部 IO」。
"""

from typing import Annotated

from fastapi import Header, Request

from lib.auth import (
    REASON_BAD_EXPIRY,
    REASON_BAD_SIGNATURE,
    REASON_BAD_SUBJECT,
    REASON_MISSING,
    REASON_TRUNCATED,
)
from lib.web.authdeps import (
    REQUIRED_CODES_ATTR,
    REQUIRED_MODE_ATTR,
    build_auth_deps,
)
from opcua_server.container import Container

__all__ = [
    "PERM_MANAGE",
    "PERM_OPERATE",
    "PERM_VIEW",
    "REQUIRED_CODES_ATTR",
    "REQUIRED_MODE_ATTR",
    "get_caller",
    "get_container",
    "get_idempotency_key",
    "require",
    "require_service_key",
]

# 三档权限码。⚠ 它们的**登记**在 auth-server 的 catalog.py（全系统唯一真源），
# 这里只是消费方的字面量；两处一致由契约测试与种子同批上线保证。
# 分三档而非两档：「能看」与「能改上位机读到的值」差一个量级的风险——
# 写值在物理上等价于对现场下指令。
PERM_VIEW = "opcua:view"
PERM_OPERATE = "opcua:operate"
PERM_MANAGE = "opcua:manage"

# 每一步各说各的：五种情况的处置完全不同（重登录 / 走网关 / 联系管理员），
# 合成一句「身份无效」等于让现场自己猜是哪一种
_MESSAGES = {
    REASON_TRUNCATED: "权限集过大，边缘未能完整下发",
    REASON_MISSING: "缺少身份头，请经边缘网关访问",
    REASON_BAD_EXPIRY: "身份头的过期时刻不是整数",
    REASON_BAD_SIGNATURE: "身份头签名不符或已过期",
    REASON_BAD_SUBJECT: "身份头的主体不是合法标识",
}


def get_container(request: Request) -> Container:
    """取组合根。

    Args: request。
    """
    container = request.app.state.container
    # pragma 理由：装配失败时进程根本起不来，这条分支没有可达的测试路径
    if not isinstance(container, Container):  # pragma: no cover
        raise RuntimeError("应用未装配 container")
    return container


def get_idempotency_key(
    idempotency_key: Annotated[str | None, Header()] = None,
) -> str | None:
    """取幂等键。

    ⚠ 写值与创建资源必须支持它：网络抖动导致的客户端重试，在没有幂等键时
    会向上位机可见的地址空间**写两次**（api-contract §7）。

    Args: idempotency_key。
    """
    return idempotency_key


def _message_of(reason: str) -> str:
    """把「卡在哪一步」翻成给用户看的一句话。

    Args: reason。
    """
    return _MESSAGES.get(reason, "身份头无效")


def _signing_secret_of(request: Request) -> str:
    settings = get_container(request).settings
    return settings.edge_signing_secret.get_secret_value()


def _service_key_of(request: Request) -> str:
    return get_container(request).settings.edge_service_key.get_secret_value()


_auth = build_auth_deps(
    signing_secret_of=_signing_secret_of,
    service_key_of=_service_key_of,
    message_of=_message_of,
)

get_caller = _auth.caller
require = _auth.require
require_service_key = _auth.service_key
