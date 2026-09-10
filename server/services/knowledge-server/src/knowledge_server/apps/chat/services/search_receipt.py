"""点位搜索回执的结构化压缩，给后续选择与实时卡片工具留预算。"""

import json
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

SEARCH_RECEIPTS_MAX_CHARS = 700
MIN_RECEIPT_CHARS = 160


class PointCandidate(BaseModel):
    """搜索回执中定位点位所需的字段。"""

    node_key: str
    name: str
    source_id: str
    source_name: str
    is_enabled: bool = True


class SearchReceipt(BaseModel):
    """平台点位搜索回执的读取边界。"""

    items: list[PointCandidate] = Field(max_length=12)
    mode: Literal["hybrid", "keyword"]
    pending_count: int = Field(ge=0)
    note: str | None = None


def _read(raw: str) -> SearchReceipt | None:
    try:
        return SearchReceipt.model_validate_json(raw)
    except ValidationError:
        return None


def compact_search_receipts(texts: list[str]) -> list[str]:
    """一批搜索共用预算，其余工具回执保持原样。Args: texts。"""
    parsed = [_read(raw) for raw in texts]
    count = sum(one is not None for one in parsed)
    limit = SEARCH_RECEIPTS_MAX_CHARS // max(1, count)
    return [
        _compact(one, limit) if one is not None else raw
        for one, raw in zip(parsed, texts, strict=True)
    ]


def _compact(receipt: SearchReceipt, limit: int) -> str:
    if limit < MIN_RECEIPT_CHARS:
        return "搜索批次过大，请一次只查询一组关键词。"
    for kept in range(len(receipt.items), -1, -1):
        rendered = _render(receipt, kept)
        if len(rendered) <= limit:
            return rendered
    return "搜索回执过大，请缩小关键词后重新查询。"


def _render(receipt: SearchReceipt, kept: int) -> str:
    points = receipt.items[:kept]
    sources = {
        one.source_id: {
            "source_id": one.source_id,
            "name": one.source_name,
            "is_enabled": one.is_enabled,
        }
        for one in points
    }
    omitted = len(receipt.items) - kept
    note = receipt.note
    if omitted:
        note = f"{note or ''}省略{omitted}个候选，需要时缩小关键词再查。"
    return json.dumps(
        {
            "mode": receipt.mode,
            "pending_count": receipt.pending_count,
            "note": note,
            "sources": list(sources.values()),
            "items": [
                {"node_key": one.node_key, "name": one.name} for one in points
            ],
            "omitted_count": omitted,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
