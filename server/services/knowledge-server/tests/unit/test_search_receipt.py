"""点位搜索压缩保留可寻址身份、降级说明和明确的省略数量。"""

import json

from knowledge_server.apps.chat.services.search_receipt import (
    compact_search_receipts,
)

SOURCE = "00000000-0000-4000-8000-000000000001"


def receipt(count: int = 6, note: str | None = None) -> str:
    return json.dumps(
        {
            "items": [
                {
                    "node_key": f"{SOURCE}:temperature{index}",
                    "name": f"水箱{index}温度",
                    "source_id": "00000000-0000-4000-8000-000000000001",
                    "source_name": "采集源",
                    "source_protocol": "modbus_tcp",
                    "is_enabled": False,
                }
                for index in range(count)
            ],
            "mode": "keyword",
            "pending_count": 6,
            "note": note,
        },
        ensure_ascii=False,
    )


def test_other_tools_and_errors_are_unchanged() -> None:
    texts = [
        '{"kind":"collect.live.v1","node_key":"source:point"}',
        "失败：没有权限",
        "{'picked':['one']}",
    ]
    assert compact_search_receipts(texts) == texts


def test_sources_are_deduplicated_and_disabled_state_is_preserved() -> None:
    result = json.loads(compact_search_receipts([receipt()])[0])
    assert len(result["sources"]) == 1
    assert result["sources"][0]["is_enabled"] is False
    assert result["sources"][0]["protocol"] == "modbus_tcp"
    assert result["items"][0]["node_key"].endswith(":temperature0")


def test_mixed_source_protocols_remain_distinguishable() -> None:
    parsed = json.loads(receipt(1))
    second = dict(parsed["items"][0])
    second["source_id"] = "00000000-0000-4000-8000-000000000002"
    second["node_key"] = f"{second['source_id']}:temperature1"
    second["source_name"] = "PLC二号线"
    second["source_protocol"] = "opcua"
    parsed["items"].append(second)
    result = json.loads(compact_search_receipts([json.dumps(parsed)])[0])
    assert {one["protocol"] for one in result["sources"]} == {
        "modbus_tcp",
        "opcua",
    }


def test_multiple_searches_share_the_total_budget() -> None:
    results = compact_search_receipts([receipt(), receipt()])
    assert sum(map(len, results)) <= 700
    for raw in results:
        result = json.loads(raw)
        assert result["omitted_count"] > 0
        assert "省略" in result["note"]


def test_embedding_degradation_is_not_hidden() -> None:
    result = json.loads(
        compact_search_receipts([receipt(0, "语义检索不可用")])[0]
    )
    assert result["note"] == "语义检索不可用"
    assert result["mode"] == "keyword"
    assert result["pending_count"] == 6
    assert result["items"] == []


def test_large_parallel_batches_receive_explicit_guidance() -> None:
    results = compact_search_receipts([receipt()] * 10)
    assert all("一次只查询" in result for result in results)
    assert sum(map(len, results)) <= 700


def test_oversized_notes_are_not_silently_returned_as_empty_matches() -> None:
    result = compact_search_receipts([receipt(0, "说明" * 1000)])[0]
    assert "回执过大" in result
