"""这套部署接了哪几路来源，以及按 kind 挑其中一路。

⚠ 注册是**显式元组**，不靠 import 副作用（ADR-0029 决策四）。

⚠ 注册表**按请求造**：上传那一路握着对象存储客户端，而外部系统那一路握着
一次调用要转发的身份头——做成进程级单例会让两个用户互相借用对方的身份。
"""

from collections.abc import Mapping
from dataclasses import dataclass, field

import httpx

from knowledge_server.apps.knowledge.services.sources.platform_source import (
    PlatformSource,
)
from knowledge_server.apps.knowledge.services.sources.ports import (
    KnowledgeSource,
)
from knowledge_server.apps.knowledge.services.sources.upload import (
    UploadSource,
)
from lib.objectstore import ObjectStore


class UnknownSource(LookupError):
    """注册表里没有这一路来源。"""


class DuplicateSource(RuntimeError):
    """两路来源报了同一个 kind。

    ⚠ 在装配期就抛，不留到运行期：重名时后注册的那一路会被前一路遮掉，
    而遮掉的是哪一个从外面完全看不出来。
    """


def _no_headers() -> Mapping[str, str]:
    """没给身份头时的空表。

    ⚠ 写成函数而不是 `default_factory=dict`：裸 `dict` 在类型检查里是
    `dict[Unknown, Unknown]`，那一格的未知会一路带进两路来源的构造。
    """
    return {}


@dataclass(frozen=True)
class SourceDeps:
    """造一份来源注册表要的那几样资源。

    ⚠ 打成一包而不是逐个形参：每接一路来源就多一两格，而调用面的形参上限
    是 5。到顶那天最省事的改法是把新资源塞进已有的某一格里，而那正是让两路
    来源开始互相知道对方的第一步。
    """

    store: ObjectStore
    # 打 platform 的客户端；不给即外部系统那一路缺席
    platform: httpx.AsyncClient | None = None
    # 这一次要转发的签名身份头。⚠ 按请求给：做成进程级单例会让两个用户
    # 互相借用对方的身份
    headers: Mapping[str, str] = field(default_factory=_no_headers)


def build_sources(deps: SourceDeps) -> tuple[KnowledgeSource, ...]:
    """按注册序装出这一次能用的那几路。

    ⚠ 顺序即界面上的先后。加一路 = 加一个文件 + 这里一行 + 一条契约测试。

    Args: deps。
    """
    made: list[KnowledgeSource] = [UploadSource(store=deps.store)]
    if deps.platform is not None:
        made.append(PlatformSource(client=deps.platform, headers=deps.headers))
    return tuple(made)


def source_for(
    kind: str, sources: tuple[KnowledgeSource, ...]
) -> KnowledgeSource:
    """按 kind 挑一路；认不出就抛。

    Args: kind, sources。
    """
    for one in sources:
        if one.kind == kind:
            return one
    raise UnknownSource(
        f"没有叫 {kind} 的来源。这套部署接了："
        f"{'、'.join(one.kind for one in sources)}"
    )


def source_kinds(sources: tuple[KnowledgeSource, ...]) -> tuple[str, ...]:
    """接了哪几路，按注册序；顺路查重名。

    Args: sources。
    """
    names = tuple(one.kind for one in sources)
    if len(set(names)) != len(names):
        raise DuplicateSource(f"来源 kind 撞名了：{names}")
    return names
