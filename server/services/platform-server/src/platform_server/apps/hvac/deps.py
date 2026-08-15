"""FastAPI 依赖注入件 —— 闸 2。

闸 1（路由规则）在边缘执行，绕过边缘直连端口时它不生效；闸 2 贴着代码，
**任何路径都生效**。两者对同一端点的权限码必须一致，由契约测试锁死。

⚠ 本服务不自己校验令牌：它读的是边缘调过 auth-server `/verify` 之后注入的
签名身份头。签名是关键——没有它，任何人直接 `curl -H "X-Auth-Permissions: …"`
就是超管。
"""

from collections.abc import AsyncIterator, Awaitable, Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import BackgroundTasks, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from lib.auth import CallerContext
from lib.db import Database
from lib.errors import PermissionDenied, Unauthenticated
from lib.utils.timeutils import utcnow
from platform_server.apps.hvac.services import caller_from_headers
from platform_server.apps.hvac.services.ac_model_queue import TrainMessage
from platform_server.apps.hvac.services.ac_model_service import (
    dispatch_training,
)
from platform_server.apps.hvac.services.ac_publish_service import Sessions
from platform_server.apps.hvac.services.ac_source_reader import AcSourceReader
from platform_server.apps.hvac.services.ac_startup_service import (
    ShardDispatch,
    dispatch_shards,
)
from platform_server.container import Container
from platform_server.opcua import NodeWriter
from platform_server.stream import StreamGroup, StreamLike

# 端点声明自己要的权限码，契约测试遍历路由时读它
REQUIRED_CODES_ATTR = "__auth_required_codes__"
REQUIRED_MODE_ATTR = "__auth_required_mode__"


def get_container(request: Request) -> Container:
    """取组合根。

    Args: request。
    """
    container = request.app.state.container
    # pragma 理由：装配失败时进程根本起不来，这条分支没有可达的测试路径
    if not isinstance(container, Container):  # pragma: no cover
        raise RuntimeError("应用未装配 container")
    return container


async def get_session(
    container: Annotated[Container, Depends(get_container)],
) -> AsyncIterator[AsyncSession]:
    """一个请求一个事务：正常出块提交，异常回滚。

    Args: container。
    """
    async with container.database.session() as session:
        yield session


@dataclass(frozen=True)
class Dispatcher:
    """把分片任务交出去的那只手。

    ⚠ **后台任务并不跑在事务提交之后**：FastAPI 把「发响应」放在 yield 依赖的
    退出栈里面，而 `Response.__call__` 发完响应就地 await 后台任务——于是投递
    排在 `get_session` 提交之前。批次行因此必须由
    `ac_startup_service.request_rebuild` 自己提交，本类不承担落盘时机。
    """

    stream: StreamLike
    target: StreamGroup
    model_target: StreamGroup
    database: Database
    tasks: BackgroundTasks

    def after_commit(self, plan: ShardDispatch) -> None:
        """排一次提交后的分片投递。

        Args: plan。
        """
        self.tasks.add_task(
            dispatch_shards,
            self.stream,
            self.database,
            target=self.target,
            plan=plan,
        )

    def after_commit_training(self, message: TrainMessage) -> None:
        """排一次提交后的训练投递。

        Args: message。
        """
        self.tasks.add_task(
            dispatch_training,
            self.stream,
            self.database,
            target=self.model_target,
            message=message,
        )


def get_dispatcher(
    container: Annotated[Container, Depends(get_container)],
    tasks: BackgroundTasks,
) -> Dispatcher:
    """装出提交后投递用的那只手。测试用 `dependency_overrides` 换成假件。

    Args: container, tasks。
    """
    settings = container.settings
    return Dispatcher(
        stream=container.stream,
        target=StreamGroup(
            stream=settings.acstartup_stream,
            group=settings.acstartup_group,
            consumer=settings.app_instance,
        ),
        model_target=StreamGroup(
            stream=settings.acmodel_stream,
            group=settings.acmodel_group,
            consumer=settings.app_instance,
        ),
        database=container.database,
        tasks=tasks,
    )


def get_ac_source_reader(
    container: Annotated[Container, Depends(get_container)],
) -> AcSourceReader:
    """外部只读库的读取面。测试用 `dependency_overrides` 换成假件。

    Args: container。
    """
    return AcSourceReader(
        source=container.ac_source,
        timezone=container.settings.acsource_timezone,
    )


def get_sessions(
    container: Annotated[Container, Depends(get_container)],
) -> Sessions:
    """开短事务的那一面。预测下发要开三个互不相干的短事务，不能借请求那条。

    ⚠ 测试用 `dependency_overrides` 换成用例那条回滚事务。

    Args: container。
    """
    return container.database


def get_node_writer(
    container: Annotated[Container, Depends(get_container)],
) -> NodeWriter:
    """opcua-server 的下发面。测试用 `dependency_overrides` 换成假件。

    Args: container。
    """
    return container.nodes


async def get_caller(
    request: Request,
    container: Annotated[Container, Depends(get_container)],
) -> CallerContext:
    """从边缘注入的签名身份头解出调用者。验不过一律 401。

    Args: request, container。
    """
    caller = caller_from_headers(
        request.headers,
        signing_secret=(
            container.settings.edge_signing_secret.get_secret_value()
        ),
        now=utcnow(),
    )
    if caller is None:
        raise Unauthenticated("身份信息缺失或已过期，请重新登录")
    return caller


def require(
    *codes: str, mode: str = "all"
) -> Callable[[CallerContext], Awaitable[CallerContext]]:
    """闸 2：要求调用者持有给定权限码。

    Args: codes, mode（`all` 全持有 / `any` 任一即可）。
    """
    required = frozenset(codes)

    async def dependency(
        caller: Annotated[CallerContext, Depends(get_caller)],
    ) -> CallerContext:
        satisfied = (
            caller.has_any(required)
            if mode == "any"
            else caller.has_all(required)
        )
        if not satisfied:
            raise PermissionDenied("没有该操作的权限")
        return caller

    setattr(dependency, REQUIRED_CODES_ATTR, required)
    setattr(dependency, REQUIRED_MODE_ATTR, mode)
    return dependency
