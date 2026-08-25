"""计划：模型的执行清单，写在会话上、每轮渲染进提示词（ADR-0024）。

⚠ 计划**落库不落内存**。api 角色无状态，续跑可能落到另一个副本上——与
`awaiting_client` 待续状态同一个理由。

⚠ `plan.write` 是**整份重写**，不是增量：增量要 id 对齐与合并语义，模型在
这两件事上的错误率远高于「把整份列表再说一遍」。

⚠ 入参校验宽严有别：格式坏（不是列表、缺标题）就抛，让模型收到失败自己纠正；
「两项同时 in_progress」这种纪律问题就地扶正，不值得多一次往返。
"""

import uuid
from collections.abc import Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field
from typing import Any, cast

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from ai_assistant.apps.chat.models import ChatSession

# 开一个数据库会话的口子。与 advance_service 的同形；不从那边 import 是因为
# 那边要 import 本模块，方向反了就是环
SessionFactory = Callable[[], AbstractAsyncContextManager[AsyncSession]]

# 一份计划最多几项。再多的活该拆成几次对话，而不是一张读不完的清单
MAX_PLAN_ITEMS = 30
MAX_ITEM_TITLE_CHARS = 200
MAX_NOTE_CHARS = 500

PLAN_WRITE = "plan.write"

ITEM_STATUSES = ("pending", "in_progress", "done", "skipped", "failed")
# 到这几档就算这一项走完了；全部走完计划自动完结
TERMINAL_STATUSES = frozenset({"done", "skipped", "failed"})

PLAN_STATES = ("active", "done")


class PlanInvalid(ValueError):
    """计划入参不成形。抛给模型让它自己纠正。"""


@dataclass(frozen=True)
class PlanUpdate:
    """计划变了：把整份快照推给前端。"""

    plan: dict[str, Any]


def is_plan_tool(name: str) -> bool:
    """这个工具名归不归计划子系统管。

    Args: name。
    """
    return name == PLAN_WRITE


def plan_of(arguments: dict[str, Any]) -> dict[str, Any]:
    """把 `plan.write` 的入参收成一份合法计划。

    Args: arguments。
    """
    given = arguments.get("items")
    if not isinstance(given, list) or not given:
        raise PlanInvalid("items 必须是非空列表")
    # ⚠ 收窄一次而不是逐处断言：`isinstance` 从 `Any` narrow 出来的是
    # `list[Unknown]`，不收的话未知类型一路传染到渲染层
    raw = cast("list[object]", given)
    if len(raw) > MAX_PLAN_ITEMS:
        raise PlanInvalid(f"计划最多 {MAX_PLAN_ITEMS} 项，拆小一点")
    items = [_item_of(one) for one in raw]
    _keep_single_in_progress(items)
    title = str(arguments.get("title") or "").strip()[:MAX_ITEM_TITLE_CHARS]
    return {"title": title, "state": _state_of(items), "items": items}


def _item_of(given: object) -> dict[str, Any]:
    """收一项。

    Args: given。
    """
    if not isinstance(given, dict):
        raise PlanInvalid("每一项必须是对象")
    body = cast("dict[str, object]", given)
    title = str(body.get("title") or "").strip()
    if not title:
        raise PlanInvalid("每一项都要有 title")
    status = str(body.get("status") or "pending")
    if status not in ITEM_STATUSES:
        raise PlanInvalid(f"status 只认 {'/'.join(ITEM_STATUSES)}")
    note = str(body.get("note") or "").strip()
    return {
        "title": title[:MAX_ITEM_TITLE_CHARS],
        "status": status,
        "note": note[:MAX_NOTE_CHARS],
    }


def _keep_single_in_progress(items: list[dict[str, Any]]) -> None:
    """至多一项进行中；多出来的就地退回待办，不值得为纪律问题多一次往返。

    Args: items。
    """
    seen = False
    for item in items:
        if item["status"] != "in_progress":
            continue
        if seen:
            item["status"] = "pending"
        seen = True


def _state_of(items: list[dict[str, Any]]) -> str:
    """全部走完计划就算完结。

    Args: items。
    """
    done = all(one["status"] in TERMINAL_STATUSES for one in items)
    return "done" if done else "active"


def render(plan: dict[str, Any] | None) -> str:
    """把计划渲染成提示词的一段；没有活跃计划就是空串。

    ⚠ 进行中的那一项**单独点名**——这一句就是当前这一步的专属提示词。
    埋在清单里的话，模型十次里有几次接着做的是别的项。

    Args: plan。
    """
    if plan is None or plan.get("state") != "active":
        return ""
    given = plan.get("items")
    if not isinstance(given, list) or not given:
        return ""
    items = [_as_item(one) for one in cast("list[object]", given)]
    lines = [_line_of(index, one) for index, one in enumerate(items, start=1)]
    current = _current_line(items)
    header = str(plan.get("title") or "").strip()
    parts = [
        f"## 当前计划{f'：{header}' if header else ''}",
        "",
        *lines,
        "",
        current,
        "完成当前项后**立刻**用 `plan.write` 整份更新状态，再开下一项。",
    ]
    return "\n".join(one for one in parts if one)


_MARKS = {
    "pending": "[ ]",
    "in_progress": "[>]",
    "done": "[x]",
    "skipped": "[-]",
    "failed": "[!]",
}


def _as_item(given: object) -> dict[str, object]:
    """库里读回来的一项收成确定形状；不是对象就当空项。

    Args: given。
    """
    if not isinstance(given, dict):
        return {}
    return cast("dict[str, object]", given)


def _line_of(index: int, item: dict[str, object]) -> str:
    mark = _MARKS.get(str(item.get("status")), "[ ]")
    note = str(item.get("note") or "").strip()
    tail = f"（{note}）" if note else ""
    return f"{index}. {mark} {item.get('title')}{tail}"


def _current_line(items: list[dict[str, object]]) -> str:
    """点名当前项：有进行中的说它，没有就说该开哪一项。

    Args: items。
    """
    for index, item in enumerate(items, start=1):
        if item.get("status") == "in_progress":
            return f"你正在做第 {index} 项：**{item.get('title')}**。"
    for index, item in enumerate(items, start=1):
        if item.get("status") == "pending":
            return (
                f"下一项是第 {index} 项：**{item.get('title')}**。"
                "开始做之前先把它标成 in_progress。"
            )
    return ""


@dataclass
class PlanTools:
    """计划工具的执行面。按回合造，握着会话 id 与开库会话的口子。

    ⚠ 不并进 `ServerTools`：那一包按「转发身份头打 platform」组织，而计划
    读写的是**本服务自己的库**。混在一起，两种失败（上游不可达 / 本库写不进）
    就分不开档了。
    """

    sessions: SessionFactory
    chat_session_id: uuid.UUID
    # 本回合最近一次写下的计划快照；编排层据它推 `plan` 事件
    latest: dict[str, Any] | None = field(default=None)

    async def run(self, name: str, arguments: dict[str, Any]) -> Any:
        """跑一个计划工具。

        Args: name, arguments。
        """
        if name != PLAN_WRITE:
            raise PlanInvalid(f"没有这个计划工具：{name}")
        plan = plan_of(arguments)
        async with self.sessions() as session:
            await session.execute(
                update(ChatSession)
                .where(ChatSession.id == self.chat_session_id)
                .values(plan_json=plan)
            )
        self.latest = plan
        done = sum(
            1 for one in plan["items"] if one["status"] in TERMINAL_STATUSES
        )
        return {
            "ok": True,
            "state": plan["state"],
            "done": done,
            "total": len(plan["items"]),
        }
