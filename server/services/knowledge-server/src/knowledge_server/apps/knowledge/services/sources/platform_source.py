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
from http import HTTPStatus
from typing import Any, cast

import httpx

from knowledge_server.apps.knowledge.errors import (
    SourceAccessDenied,
    SourceIdentityExpired,
    SourceReadFailed,
)
from knowledge_server.apps.knowledge.services.parsing import RawItem
from knowledge_server.apps.knowledge.services.sources.ports import (
    DiscoveredItem,
    DiscoveredPage,
    SourceUnavailable,
)
from lib.errors import ValidationFailed

PLATFORM_KIND = "platform"

# 一次 discover 拉多少条
PAGE_SIZE = 50
# 单条记录渲染成正文的字符上限。⚠ 有上限：一行里塞进一整篇说明书是现场常事
MAX_ITEM_CHARS = 20_000
TEMPORARY_HTTP_STATUSES = (
    HTTPStatus.REQUEST_TIMEOUT,
    HTTPStatus.TOO_MANY_REQUESTS,
    HTTPStatus.INTERNAL_SERVER_ERROR,
    HTTPStatus.BAD_GATEWAY,
    HTTPStatus.SERVICE_UNAVAILABLE,
    HTTPStatus.GATEWAY_TIMEOUT,
)

_SCHEMA: Mapping[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["path"],
    "properties": {
        "path": {
            "type": "string",
            "minLength": 1,
            "pattern": "^/(?!/)",
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
        raise SourceReadFailed("来源响应格式无效，请检查平台路径后重新同步")
    data = cast("dict[str, object]", body).get("data")
    if isinstance(data, list):
        items = cast("list[object]", data)
    elif isinstance(data, dict):
        items = cast("dict[str, object]", data).get("items")
    else:
        raise SourceReadFailed("来源响应格式无效，请检查平台路径后重新同步")
    if not isinstance(items, list):
        raise SourceReadFailed("来源记录格式无效，请检查平台路径后重新同步")
    given = cast("list[object]", items)
    if any(not isinstance(one, dict) for one in given):
        raise SourceReadFailed("来源记录格式无效，请检查平台路径后重新同步")
    return cast("list[Mapping[str, Any]]", given)


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
            raise ValidationFailed("这一路来源的路径没配，或者不是一条平台路径")
        params = {
            _config(config, "page_param", "page"): str(page),
            _config(config, "size_param", "size"): str(PAGE_SIZE),
        }
        try:
            answer = await self.client.get(
                path, params=params, headers=dict(self.headers)
            )
            answer.raise_for_status()
        except httpx.HTTPStatusError as error:
            _reject_status(error.response.status_code)
            raise SourceUnavailable("来源暂时不可用，请稍后重新同步") from error
        except (
            httpx.TimeoutException,
            httpx.NetworkError,
            httpx.RemoteProtocolError,
        ) as error:
            raise SourceUnavailable("来源暂时不可用，请稍后重新同步") from error
        except (httpx.HTTPError, httpx.InvalidURL) as error:
            raise SourceReadFailed(
                "无法读取来源，请检查来源配置后重新同步"
            ) from error
        try:
            return _rows(answer.json())
        except ValueError as error:
            raise SourceReadFailed(
                "来源响应不是有效 JSON，请检查平台路径后重新同步"
            ) from error

    async def fetch(self, config: Mapping[str, Any], ref: str) -> RawItem:
        """这一路的内容在 `discover` 就带回来了，不再单独取。

        ⚠ 抛而不是回空：走到这里说明编排把这一路当成了推送型来源，
        而那时静默给空会让一份空文档进到库里、状态还是 ready。

        Args: config, ref。
        """
        del config, ref
        raise SourceReadFailed("这一路来源不支持单独读取原件，请重新同步来源")


def _item(config: Mapping[str, Any], row: Mapping[str, Any]) -> DiscoveredItem:
    """一行记录摊成一个待摄取条目。

    Args: config, row。
    """
    identity = _identity_of(row.get(_config(config, "id_field", "row_id")))
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


def _identity_of(value: object) -> str:
    """拒绝缺失或不能稳定辨识记录的行标识。Args: value。"""
    if isinstance(value, str) and value.strip():
        return value
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    raise SourceReadFailed(
        "来源记录缺少有效的行标识，请检查行标识字段配置后重新同步"
    )


def _reject_status(status: int) -> None:
    """将不可恢复的上游拒绝转换为安全的领域错误。Args: status。"""
    if status == HTTPStatus.UNAUTHORIZED:
        raise SourceIdentityExpired("来源读取身份已失效，请重新登录后同步")
    if status == HTTPStatus.FORBIDDEN:
        raise SourceAccessDenied("没有读取平台来源的权限，请联系管理员授权")
    if status not in TEMPORARY_HTTP_STATUSES:
        raise SourceReadFailed("无法读取来源，请检查来源配置后重新同步")


def rows_of(page: DiscoveredPage) -> Sequence[DiscoveredItem]:
    """一页里的条目。给调用方一个不必知道内部形状的口子。

    Args: page。
    """
    return page.items
