"""技能正文与资源的按需读取，调用范围由本回合选择结果限定。"""

import asyncio
import json
from typing import Any

from llmcore.skills import SkillManifest
from llmcore.skills.loader import read_resource

MAX_RESOURCE_CHARS = 12_000


def selected_skill(
    skills: tuple[SkillManifest, ...], name: object
) -> SkillManifest:
    """只返回本轮和账号可见的技能。Args: skills, name。"""
    skill = next((one for one in skills if one.name == name), None)
    if skill is None:
        available = ", ".join(one.name for one in skills) or "无"
        raise ValueError(f"本轮未提供这个技能或权限不足；可用技能：{available}")
    return skill


def load_skill(skill: SkillManifest) -> dict[str, object]:
    """返回正文与资源索引，不展开资源正文。Args: skill。"""
    return {
        "ok": True,
        "name": skill.name,
        "title": skill.title,
        "instructions": skill.instructions(),
        "compatibility": skill.compatibility,
        "resources": list(skill.resources),
        "resource_base": f"skill://{skill.name}/",
        "next_action": "需要引用材料时调用 skills.read_resource；"
        "只使用本轮提供的工具。",
    }


async def resource_answer(
    skills: tuple[SkillManifest, ...],
    arguments: dict[str, Any],
    max_chars: int = MAX_RESOURCE_CHARS,
    *,
    max_output_chars: int = 0,
) -> dict[str, object]:
    """在线程中读文本资源，返回可继续读取的完整行。Args: skills, arguments。"""
    skill = selected_skill(skills, arguments.get("name"))
    relative = arguments.get("path")
    if not isinstance(relative, str):
        raise ValueError("path 必须取自 skills.load 返回的资源索引")
    start = _line_number(arguments.get("start_line", 1), "start_line", 100_000)
    limit = _line_number(arguments.get("limit", 80), "limit", 200)
    text = await asyncio.to_thread(read_resource, skill, relative)
    lines = text.splitlines()
    if start > max(1, len(lines)):
        raise ValueError(
            f"start_line 超出文件行数 {len(lines)}，请从第 1 行读取"
        )
    selected: list[str] = []
    for line in lines[start - 1 : start - 1 + limit]:
        if sum(len(one) + 1 for one in selected) + len(line) > max_chars:
            if not selected:
                raise ValueError(
                    f"资源单行超过 {max_chars} 字符，请将资源拆分为较短的行"
                )
            break
        selected.append(line)
    while selected:
        result = _resource_page(
            skill.name, relative, selected, start, len(lines)
        )
        if (
            not max_output_chars
            or len(json.dumps(result, ensure_ascii=False)) <= max_output_chars
        ):
            return result
        selected.pop()
    if lines:
        raise ValueError(
            "本次预算不足以返回一个完整资源行及分页信息；请增加上下文预算"
        )
    return _resource_page(skill.name, relative, [], start, len(lines))


def _resource_page(
    name: str, relative: str, selected: list[str], start: int, total: int
) -> dict[str, object]:
    end = start - 1 + len(selected)
    return {
        "name": name,
        "path": relative,
        "content": "\n".join(selected),
        "start_line": start,
        "end_line": end,
        "total_lines": total,
        "has_more": end < total,
        "next_line": end + 1 if end < total else None,
    }


def _line_number(value: object, name: str, maximum: int) -> int:
    if type(value) is not int or not 1 <= value <= maximum:
        raise ValueError(f"{name} 必须是 1 到 {maximum} 的整数")
    return value
