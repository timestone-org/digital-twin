"""打 platform 业务面的瘦客户端。

⚠ 它**代表用户**说话：每次调用带上边缘注入的那组签名身份头，platform 按用户
自己的权限码判定。助手因此不是绕过权限的通道——它读不到用户本来读不到的东西。

⚠ 这一层**不重试**。一条链路只有一层负责重试，而那一层是编排层
（runtime-resilience §4.2）；在这里补一层会让一次超时变成三次，把上游的预算
悄悄用光。

⚠ 失败一律抛，不返回空清单。把「取不到点位」读成「没有点位」，会让助手对着
一屏它以为空的画布下结论。
"""

from typing import Any, cast

import httpx
from pydantic import BaseModel, ValidationError

from lib.errors import DependencyUnavailable
from lib.logging import current_traceparent, get_logger

_logger = get_logger("assistant.upstream.platform")

_POINTS = "/api/v1/platform/collect-points"
_SOURCES = "/api/v1/platform/collect-sources"
_DASHBOARDS = "/api/v1/platform/dashboards"
_MODULES = "/api/v1/platform/module-types"
_TABLES = "/api/v1/platform/dataset-tables"
_ASSETS = "/api/v1/platform/assets"


class PlatformUnavailable(DependencyUnavailable):
    """platform 没答上来。"""

    code = 52210


class _Envelope(BaseModel):
    """统一信封，本地只取 data。"""

    data: object = None


class PlatformClient:
    """构造不连网；连接池一个进程一份。"""

    def __init__(
        self, *, base_url: str, timeout_s: float, page_size: int = 200
    ) -> None:
        """按地址与超时初始化。

        Args: base_url, timeout_s, page_size（一次拉多少条点位）。
        """
        self._base_url = base_url.rstrip("/")
        self._timeout_s = timeout_s
        self._page_size = page_size
        # 传输层留成可替换的：用例验的是调用形状与失败处置，不是 httpx 本身
        self._transport: httpx.AsyncBaseTransport | None = None
        self._http: httpx.AsyncClient | None = None

    def use_transport(self, transport: httpx.AsyncBaseTransport) -> None:
        """换掉传输层。只给测试用；必须在第一次调用之前换。

        Args: transport。
        """
        self._transport = transport

    async def close(self) -> None:
        """关连接池。装了就要关，否则退出时留下一组还开着的 socket。"""
        http, self._http = self._http, None
        if http is not None:
            await http.aclose()

    async def list_sources(self, headers: dict[str, str]) -> list[object]:
        """列出全部采集数据源。

        Args: headers（要转发的身份头）。
        """
        body = await self._get(_SOURCES, {"size": 200}, headers)
        return _items_of(body)

    async def search_points(
        self,
        headers: dict[str, str],
        *,
        keyword: str | None = None,
        source_id: str | None = None,
        page: int = 1,
    ) -> list[object]:
        """按关键词与数据源翻一页点位。

        ⚠ 后端那侧的 `q` 只对**名字与编码**做子串匹配，且永远是顺序扫描。
        真正的挑选在助手侧做（见 `services/point_recall.py`），这里只负责取。

        Args: headers, keyword, source_id, page。
        """
        query: dict[str, Any] = {"page": page, "size": self._page_size}
        if keyword:
            query["q"] = keyword
        if source_id:
            query["source_id"] = source_id
        return _items_of(await self._get(_POINTS, query, headers))

    async def list_module_types(self, headers: dict[str, str]) -> object:
        """取整份模块清单。

        ⚠ 它是**唯一的模块真源**：模块有什么配置字段、字段什么类型、有哪些
        可选值全在里面。没有它，助手要摆一个模块就只能凭印象填键名，而写错的
        键存得下去、也不报错，画面上表现为「配了没反应」。

        Args: headers。
        """
        return await self._get(_MODULES, {}, headers)

    async def read_module_type(
        self, headers: dict[str, str], module_type: str
    ) -> object:
        """取一个模块类型的完整清单。

        Args: headers, module_type。
        """
        return await self._get(f"{_MODULES}/{module_type}", {}, headers)

    async def formula_functions(
        self, headers: dict[str, str], table_id: str
    ) -> object:
        """取一张台账能用的函数目录、可引用的列与表、公式库。

        Args: headers, table_id。
        """
        return await self._get(
            f"{_TABLES}/{table_id}/formula-functions", {}, headers
        )

    async def check_formula(
        self, headers: dict[str, str], table_id: str, body: dict[str, Any]
    ) -> object:
        """校验一条公式。

        ⚠ 公式写错回的是 **200 + `is_ok=false`**，不是 HTTP 错误。把它当成
        调用失败的话，助手会以为是自己这一侧坏了，而真正该看的那句错在体里。

        Args: headers, table_id, body。
        """
        return await self._post(
            f"{_TABLES}/{table_id}/formula:validate", headers, body
        )

    async def try_formula(
        self, headers: dict[str, str], table_id: str, body: dict[str, Any]
    ) -> object:
        """用一组样例值试算一条公式。

        Args: headers, table_id, body。
        """
        return await self._post(
            f"{_TABLES}/{table_id}/formula:preview", headers, body
        )

    async def list_dashboards(
        self,
        headers: dict[str, str],
        *,
        keyword: str | None = None,
        project_id: str | None = None,
    ) -> object:
        """翻第一页大屏清单。回整个分页体，`total` 留给调用方做截断说明。

        Args: headers, keyword（按名字模糊筛）, project_id（限定项目）。
        """
        query: dict[str, Any] = {"page": 1, "size": self._page_size}
        if keyword:
            query["q"] = keyword
        if project_id:
            query["project_id"] = project_id
        return await self._get(_DASHBOARDS, query, headers)

    async def list_dataset_tables(
        self, headers: dict[str, str], *, keyword: str | None = None
    ) -> object:
        """翻第一页台账清单。回整个分页体，`total` 留给调用方做截断说明。

        Args: headers, keyword（按名称与编码模糊筛）。
        """
        query: dict[str, Any] = {"page": 1, "size": self._page_size}
        if keyword:
            query["q"] = keyword
        return await self._get(_TABLES, query, headers)

    async def list_dataset_columns(
        self, headers: dict[str, str], table_id: str
    ) -> list[object]:
        """一张台账已保存的全部列。集合有界，上游不分页。

        Args: headers, table_id。
        """
        body = await self._get(f"{_TABLES}/{table_id}/columns", {}, headers)
        return _rows_of(body)

    async def list_assets(
        self,
        headers: dict[str, str],
        *,
        keyword: str | None = None,
        kind: str | None = None,
        limit: int = 50,
    ) -> list[object]:
        """按关键词与类型列素材，新的在前。上游不给总数，只给这一窗。

        Args: headers, keyword（按名字模糊筛）, kind（素材类型）, limit。
        """
        query: dict[str, Any] = {"limit": limit, "offset": 0}
        if keyword:
            query["q"] = keyword
        if kind:
            query["kind"] = kind
        return _rows_of(await self._get(_ASSETS, query, headers))

    async def find_point(
        self, headers: dict[str, str], *, source_id: str, code: str
    ) -> object | None:
        """按 `(source_id, code)` 找那一个点位；没有就给 None。

        ⚠ 上游没有按编码精确取一条的端点，`q` 是名字/编码的模糊匹配；
        这里先按 `q=code` 缩一页，再本地按编码逐字比对。

        Args: headers, source_id, code。
        """
        query: dict[str, Any] = {
            "page": 1,
            "size": self._page_size,
            "source_id": source_id,
            "q": code,
        }
        rows = _items_of(await self._get(_POINTS, query, headers))
        return next((row for row in rows if _code_of(row) == code), None)

    async def validate_dashboard(
        self, headers: dict[str, str], dashboard_id: str
    ) -> object:
        """让 platform 自检一张大屏，列出全部悬空引用。

        Args: headers, dashboard_id。
        """
        return await self._post(
            f"{_DASHBOARDS}/{dashboard_id}:validate", headers
        )

    def _client(self) -> httpx.AsyncClient:
        """一个进程一份，懒建。

        ⚠ 每次调用现造一个再关掉，等于每次都重新握一次 TCP 手，
        keep-alive 一次都用不上；懒建是因为装配跑在事件循环之外。
        """
        if self._http is None:
            self._http = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=self._timeout_s,
                transport=self._transport,
            )
        return self._http

    async def _get(
        self, path: str, query: dict[str, Any], headers: dict[str, str]
    ) -> object:
        return await self._call("GET", path, headers, params=query)

    async def _post(
        self,
        path: str,
        headers: dict[str, str],
        body: dict[str, Any] | None = None,
    ) -> object:
        return await self._call("POST", path, headers, json=body or {})

    async def _call(
        self,
        method: str,
        path: str,
        headers: dict[str, str],
        **options: Any,
    ) -> object:
        """发一次并从信封里取 data。

        Args: method, path, headers, options。
        """
        try:
            response = await self._client().request(
                method, path, headers=_with_trace(headers), **options
            )
            response.raise_for_status()
            # ⚠ 204 没有响应体：照常去解信封的话，一次**成功**的删除会被读成
            # 「响应不是预期的形状」，而调用方据此告诉用户没删掉
            if not response.content:
                return None
            return _Envelope.model_validate(response.json()).data
        except (httpx.HTTPError, ValidationError, ValueError) as error:
            _logger.warning(
                "platform_call_failed",
                "打 platform 失败",
                path=path,
                error_type=type(error).__name__,
            )
            raise PlatformUnavailable(_reason(error)) from error


def _with_trace(headers: dict[str, str]) -> dict[str, str]:
    """加上 traceparent。

    ⚠ 不带的话链路在「助手 → platform」这一跳断开，而那一跳正是「点位到底
    取没取到」的答案所在。

    Args: headers。
    """
    return {**headers, "traceparent": current_traceparent()}


def _items_of(body: object) -> list[object]:
    """从分页体里取 items；不是分页体就当空。

    ⚠ 逐层收窄而不是原样透传：信封里的 `data` 是 `object`，直接下标会把未知
    类型一路带进业务层，而 pyright strict 会在几个文件之外才报出来。

    Args: body。
    """
    if not isinstance(body, dict):
        return []
    # ⚠ 收窄一次而不是遍历重建：`isinstance(x, dict)` 从 `object` narrow 出来的
    # 是 `dict[Unknown, Unknown]`，遍历它的键值同样是未知的
    page = cast("dict[str, object]", body)
    items = page.get("items")
    if not isinstance(items, list):
        return []
    return cast("list[object]", items)


def _rows_of(body: object) -> list[object]:
    """收下「data 直接就是数组」的响应体；不是数组就当空。

    Args: body。
    """
    if not isinstance(body, list):
        return []
    return cast("list[object]", body)


def _code_of(row: object) -> str | None:
    """取一行点位的编码，取不出就给 None。

    Args: row。
    """
    if not isinstance(row, dict):
        return None
    code = cast("dict[str, object]", row).get("code")
    return code if isinstance(code, str) else None


def _reason(error: Exception) -> str:
    """给人看的失败原因。

    ⚠ 不带 URL 与密钥，只带异常类型与状态码：这句话会显示在界面上。

    Args: error。
    """
    if isinstance(error, httpx.HTTPStatusError):
        status = error.response.status_code
        return f"platform 回了 {status}{_said(error.response)}"
    if isinstance(error, httpx.TimeoutException):
        return "platform 超时未响应"
    if isinstance(error, ValidationError):
        return "platform 的响应不是预期的形状"
    return "platform 不可达"


def _said(response: httpx.Response) -> str:
    """上游信封里那句话，取不出就不带。

    ⚠ 光一个状态码不够：400 的正文里指着是哪一个字段写错了，只报「回了 400」
    的话，调用方知道不行却不知道改哪儿，于是原样再试一次。

    Args: response。
    """
    try:
        body: object = response.json()
    except ValueError:
        return ""
    if not isinstance(body, dict):
        return ""
    message = cast("dict[str, object]", body).get("message")
    if not isinstance(message, str) or not message.strip():
        return ""
    return f"：{message.strip()}"
