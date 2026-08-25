"""服务端工具的执行面：按名字分派到实现。

⚠ 认不出的名字**抛**，不返回一个看起来正常的空结果。模型编出一个不存在的工具名
是常事；静默给它一个空结果，它会当成「查过了，没有」继续往下走，最后给用户一个
自信的错误答案。

⚠ 每个实现都要能在**没有上游**时说清自己做不了什么。助手是纯消费方，platform
不可达时该说的是「取不到点位」，不是把一条空清单当成「没有点位」。

⚠ 这一整包是**按请求造**的：它握着那一次调用要转发的身份头，而那组头绑定的是
某一个用户。做成进程级单例的话，两个用户的请求会互相借用对方的身份。
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, cast

from ai_assistant.apps.chat.services.module_catalog import catalog_of
from ai_assistant.apps.chat.services.point_recall import (
    PointCandidate,
    ScoredPoint,
    rank,
)
from ai_assistant.apps.chat.skills import find_skill
from ai_assistant.upstream import PlatformClient

# 一次检索最多回几条。再多模型也读不完，而每一条都在占上下文
MAX_RESULTS = 20
# 为了凑够候选最多翻几页。⚠ 有上限：一个源可能挂着上万个点位，
# 无上限地翻会把一次工具调用变成几十次往返
MAX_PAGES = 5


# 一个工具的实现：收一袋参数，给一份结果
ToolHandler = Callable[[dict[str, Any]], Awaitable[Any]]


class UnknownServerTool(RuntimeError):
    """叫了一个不存在的服务端工具。"""


@dataclass(frozen=True)
class ServerTools:
    """服务端工具的实现集合。按请求造，握着这一次要转发的身份头。"""

    platform: PlatformClient | None = None
    headers: dict[str, str] = field(default_factory=dict[str, str])

    async def __call__(self, name: str, arguments: dict[str, Any]) -> Any:
        """按名字跑一个工具。

        ⚠ 查表而不是一串 `if`：工具是会一直加的，而一串 `if` 加到第十个就过不了
        复杂度闸，那时最省事的改法是把工具塞进别的分支里——名字与实现于是开始
        对不上。

        Args: name, arguments。
        """
        run = self._handlers().get(name)
        if run is None:
            raise UnknownServerTool(f"没有这个工具：{name}")
        return await run(arguments)

    def _handlers(self) -> dict[str, ToolHandler]:
        """工具名 → 实现。

        ⚠ 键必须与 `tool_specs.TOOL_SPECS` 里的名字逐字相同：对不上时模型
        看得见那个工具、调用它却每次都失败。
        """
        return {
            "skills.load": _skill_answer,
            "modules.catalog": self._modules,
            "points.list_sources": self._list_sources,
            "points.search": self._search_points,
            "dashboard.validate": self._validate,
        }

    def _upstream(self) -> PlatformClient:
        if self.platform is None:
            raise UnknownServerTool("本部署没有接上业务面，取不到点位")
        return self.platform

    async def _modules(self, arguments: dict[str, Any]) -> Any:
        """给模块清单：不点名就给名片表，点名就把那一个展开。

        Args: arguments。
        """
        wanted = _text_or_none(arguments.get("module_type"))
        client = self._upstream()
        if wanted is not None:
            return await client.read_module_type(self.headers, wanted)
        body = await client.list_module_types(self.headers)
        return catalog_of(body, _text_or_none(arguments.get("keyword")))

    async def _list_sources(self, _arguments: dict[str, Any]) -> Any:
        rows = await self._upstream().list_sources(self.headers)
        return {"sources": [_source_of(row) for row in rows]}

    async def _search_points(self, arguments: dict[str, Any]) -> Any:
        """按关键词找点位。

        ⚠ 先让后端按 `q` 缩一次，再在本地按名字/编码/单位打分排序。只靠后端的
        话，`K1_TMT_HOT_T_PI` 这种编码永远匹配不上「温度」两个字。

        Args: arguments。
        """
        keyword = str(arguments.get("keyword") or "").strip()
        if not keyword:
            return {"points": [], "note": "没给关键词"}
        source_id = _text_or_none(arguments.get("source_id"))
        limit = _limit_of(arguments.get("limit"))
        found = rank(
            await self._gather(keyword, source_id),
            keyword=keyword,
            limit=limit,
        )
        return {
            "points": [_hit_of(one) for one in found],
            "note": "空表就是真的没找到，不要从别处硬凑一个",
        }

    async def _gather(
        self, keyword: str, source_id: str | None
    ) -> list[PointCandidate]:
        """凑一批候选：先按关键词问一次，不够再不带关键词翻几页。

        ⚠ 后端的 `q` 只对名字与编码做子串匹配，「出口温度」找不到
        `K1_TMT_OUT_T_PI`。所以按词问不到时要退回全量翻页，由本地打分兜住。

        Args: keyword, source_id。
        """
        client = self._upstream()
        rows = await client.search_points(
            self.headers, keyword=keyword, source_id=source_id
        )
        if rows:
            return [_candidate_of(row) for row in rows]
        found: list[PointCandidate] = []
        for page in range(1, MAX_PAGES + 1):
            batch = await client.search_points(
                self.headers, source_id=source_id, page=page
            )
            if not batch:
                break
            found.extend(_candidate_of(row) for row in batch)
        return found

    async def _validate(self, arguments: dict[str, Any]) -> Any:
        dashboard_id = _text_or_none(arguments.get("dashboard_id"))
        if dashboard_id is None:
            raise UnknownServerTool("dashboard.validate 少了 dashboard_id")
        return await self._upstream().validate_dashboard(
            self.headers, dashboard_id
        )


async def _skill_answer(arguments: dict[str, Any]) -> Any:
    """技能是本地的，没有 IO；包成协程只为与别的工具同形。

    Args: arguments。
    """
    return _load_skill(str(arguments.get("name") or ""))


def _load_skill(name: str) -> dict[str, Any]:
    """取一个技能的完整指令。

    ⚠ 技能不存在时回一句「没有这个技能」而不是抛：模型多半是把名字记岔了，
    告诉它有哪些比让这一步失败有用。

    Args: name。
    """
    skill = find_skill(name)
    if skill is None:
        return {"ok": False, "reason": f"没有名为 {name} 的技能"}
    return {
        "ok": True,
        "name": skill.name,
        "title": skill.title,
        "instructions": skill.instructions(),
    }


def _candidate_of(row: object) -> PointCandidate:
    """把 platform 的一行收成候选。

    ⚠ 逐字段窄化而不是整块透传：多一个字段不要紧，少一个字段会在打分里
    崩成 None，而那时离真正的原因已经很远。

    Args: row。
    """
    body = _as_body(row)
    return PointCandidate(
        node_key=str(body.get("node_key") or ""),
        code=str(body.get("code") or ""),
        name=str(body.get("name") or ""),
        unit=_text_or_none(body.get("unit")),
        data_type=str(body.get("data_type") or ""),
    )


def _source_of(row: object) -> dict[str, Any]:
    body = _as_body(row)
    return {
        "id": body.get("id"),
        "code": body.get("code"),
        "name": body.get("name"),
        "description": body.get("description"),
    }


def _as_body(row: object) -> dict[str, object]:
    """把上游那一行收成一张确定形状的表。

    ⚠ 逐键重建而不是 `dict(row)`：后者从 `object` narrow 出来的是未知键值类型，
    一路带进打分层之后，pyright 会在几个文件之外才报出来。

    Args: row。
    """
    if not isinstance(row, dict):
        return {}
    # ⚠ 收窄一次而不是遍历重建：`isinstance` 从 `object` narrow 出来的是
    # `dict[Unknown, Unknown]`，遍历它的键值同样是未知的
    return cast("dict[str, object]", row)


def _hit_of(hit: ScoredPoint) -> dict[str, Any]:
    return {
        "node_key": hit.point.node_key,
        "code": hit.point.code,
        "name": hit.point.name,
        "unit": hit.point.unit,
        "data_type": hit.point.data_type,
        "score": hit.score,
        "why": hit.why,
    }


def _limit_of(given: Any) -> int:
    if isinstance(given, int) and 0 < given <= MAX_RESULTS:
        return given
    return MAX_RESULTS


def _text_or_none(given: Any) -> str | None:
    if isinstance(given, str) and given.strip():
        return given.strip()
    return None
