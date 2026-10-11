"""页面定位的数据边界：保留路径与标签，丢弃 URL 中的凭据载体。"""

from typing import Any, cast

from ai_assistant.apps.chat.skills.routing import page_path


def path_of(context: dict[str, Any] | None) -> str | None:
    if context is None or "page" not in context:
        return None
    page: object = context["page"]
    if not isinstance(page, dict):
        return ""
    return page_path(cast("dict[str, object]", page).get("path")) or ""


def snapshot_of(
    context: dict[str, Any] | None, label: str
) -> dict[str, Any] | None:
    """页面字段只作为有界数据进入状态块。Args: context, label。"""
    if context is None and not label:
        return None
    result = dict(context or {})
    path = path_of(context)
    if path is not None or label:
        result["page"] = {"path": path or "", "label": label[:64]}
    return result
