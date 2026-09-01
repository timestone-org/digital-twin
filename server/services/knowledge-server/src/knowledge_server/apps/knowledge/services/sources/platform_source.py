"""外部系统来源的第一个实现：从 platform 的 HTTP 面拉记录。

⚠ 经**对方的 HTTP 面**拿数据，绝不读对方的库（CONTEXT.md §2）。抄一份别人的
数据进自己的库已经够危险——那边改了名字，这边的副本不会跟着变；再绕过它的
权限判定去抄，就等于用知识库当越权通道。

⚠ 同步**在用户按下那一刻、用用户自己的身份**跑（api 角色，原样转发边缘注入的
签名头）。不存任何凭据：存了的话，一次配置泄露等于把那个人的权限交出去，
而 worker 会拿着它在无人值守时不停地读。

⚠ 摄进知识库的东西，可见性就交给知识库的权限模型了——`knowledge:use` 看得见
它，哪怕那个人在 platform 那边看不见原始记录。配来源的人（`knowledge:manage`）
要为这件事负责，界面上要说清。这与「传一份文档上来」是同一条口径。

⚠ 路径只收**平台自己的路径**，不收完整 URL：收 URL 的话，这一格就成了一个
可以指向任何内网地址的探针（SSRF）。接别的系统请写它自己的来源实现——
那正是这层注册表存在的理由。
"""

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, cast

import httpx

from knowledge_server.apps.knowledge.services.parsing import RawItem
from knowledge_server.apps.knowledge.services.sources.ports import (
    DiscoveredItem,
    DiscoveredPage,
    SourceUnavailable,
)

PLATFORM_KIND = "platform"

# 一次 discover 拉多少条
PAGE_SIZE = 50
# 单条记录渲染成正文的字符上限。⚠ 有上限：一行里塞进一整篇说明书是现场常事
MAX_ITEM_CHARS = 20_000

_SCHEMA: Mapping[str, Any] = {
    "type": "object",
    "required": ["path"],
    "properties": {
        "path": {
            "type": "string",
            "title": "平台路径",
            "description": "只收路径不收完整 URL",
        },
        "id_field": {
            "type": "string",
            "title": "行标识字段",
            "default": "row_id",
        },
        "title_field": {"type": "string", "title": "标题字段", "default": ""},
        "page_param": {
            "type": "string",
            "title": "页码参数名",
            "default": "page",
        },
        "size_param": {
            "type": "string",
            "title": "每页条数参数名",
            "default": "size",
        },
    },
}


def _config(raw: Mapping[str, Any], key: str, fallback: str) -> str:
    value = raw.get(key)
    return value if isinstance(value, str) and value else fallback


def _rows(body: object) -> list[Mapping[str, Any]]:
    """从统一信封里把 `data.items` 摘出来。

    ⚠ 认信封而不是认裸数组：本仓全服务同一套 `{code,message,data}`，
    直接当数组读的话，第一次遇到分页响应就整个读不出来。

    Args: body。
    """
    if not isinstance(body, dict):
        return []
    data = cast("dict[str, object]", body).get("data")
    if isinstance(data, list):
        return [
            one for one in cast("list[object]", data) if isinstance(one, dict)
        ]
    if not isinstance(data, dict):
        return []
    items = cast("dict[str, object]", data).get("items")
    if not isinstance(items, list):
        return []
    return [one for one in cast("list[object]", items) if isinstance(one, dict)]


def _rendered(row: Mapping[str, Any]) -> bytes:
    """把一行摊成「字段：值」的文本。

    ⚠ 摊成文本而不是存 JSON 原样：检索是对文本做的，而一段 JSON 里的花括号
    与引号会把关键词匹配搅乱，向量那一路也学不到什么。

    Args: row。
    """
    parts: list[str] = []
    for key, value in row.items():
        if value is None or value == "":
            continue
        rendered = (
            json.dumps(value, ensure_ascii=False)
            if isinstance(value, (dict, list))
            else str(value)
        )
        parts.append(f"{key}：{rendered}")
    return "\n".join(parts)[:MAX_ITEM_CHARS].encode("utf-8")


@dataclass(frozen=True)
class PlatformSource:
    """按配置的路径分页拉记录。"""

    client: httpx.AsyncClient
    headers: Mapping[str, str]
    kind: str = PLATFORM_KIND

    def config_schema(self) -> Mapping[str, Any]:
        """这一路要配什么。"""
        return _SCHEMA

    async def discover(
        self, config: Mapping[str, Any], cursor: str | None
    ) -> DiscoveredPage:
        """拉一页记录，顺手把内容也带回来。

        ⚠ 游标就是页码，存成字符串：不同来源的游标形态不同，收成整数就把
        将来挡死在类型上。

        Args: config, cursor。
        """
        page = int(cursor) if cursor and cursor.isdigit() else 1
        rows = await self._page(config, page)
        items = tuple(_item(config, one) for one in rows)
        # ⚠ 满页才认为还有下一页；不满即到底。用「空表即到底」判的话，
        # 一次恰好返回空页的中间页会让同步提前收工
        more = str(page + 1) if len(rows) >= PAGE_SIZE else None
        return DiscoveredPage(items=items, cursor=more)

    async def _page(
        self, config: Mapping[str, Any], page: int
    ) -> list[Mapping[str, Any]]:
        path = _config(config, "path", "")
        if not path.startswith("/"):
            raise SourceUnavailable(
                "这一路来源的路径没配，或者不是一条平台路径"
            )
        params = {
            _config(config, "page_param", "page"): str(page),
            _config(config, "size_param", "size"): str(PAGE_SIZE),
        }
        try:
            answer = await self.client.get(
                path, params=params, headers=dict(self.headers)
            )
            answer.raise_for_status()
        except httpx.HTTPError as error:
            raise SourceUnavailable(f"拉不到 {path}") from error
        return _rows(answer.json())

    async def fetch(self, config: Mapping[str, Any], ref: str) -> RawItem:
        """这一路的内容在 `discover` 就带回来了，不再单独取。

        ⚠ 抛而不是回空：走到这里说明编排把这一路当成了推送型来源，
        而那时静默给空会让一份空文档进到库里、状态还是 ready。

        Args: config, ref。
        """
        del config
        raise SourceUnavailable(
            f"{PLATFORM_KIND} 的内容随 discover 一起回来，取不了单条：{ref}"
        )


def _item(config: Mapping[str, Any], row: Mapping[str, Any]) -> DiscoveredItem:
    """一行记录摊成一个待摄取条目。

    Args: config, row。
    """
    identity = str(row.get(_config(config, "id_field", "row_id"), ""))
    title_field = _config(config, "title_field", "")
    title = str(row.get(title_field, "")) if title_field else ""
    content = _rendered(row)
    return DiscoveredItem(
        external_ref=identity,
        # ⚠ 后缀必须带上：它是解析器分派的唯一判据，而这里的内容是纯文本
        title=f"{title or identity}.md",
        media_type="text/markdown",
        byte_size=len(content),
        content=content,
    )


def rows_of(page: DiscoveredPage) -> Sequence[DiscoveredItem]:
    """一页里的条目。给调用方一个不必知道内部形状的口子。

    Args: page。
    """
    return page.items
