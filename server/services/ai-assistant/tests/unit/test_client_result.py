"""模型读取客户端回执时保留身份与续查信息，并压缩重复字段。"""

import json

import pytest

from ai_assistant.apps.chat.services.client_result import ClientToolResult


def test_screenshot_is_handed_off_without_entering_tool_text() -> None:
    image = "data:image/png;base64,fixture"
    result = ClientToolResult(call_id="capture", output=image)

    assert result.as_text() == "截图好了，图在下一条消息里。"
    assert result.image() == image


@pytest.mark.parametrize(
    "identity",
    ["source:PLC[1].A&B", "source:PLC_channel_12|REAL/14"],
    ids=["array-and-ampersand", "underscore-and-pipe"],
)
def test_point_identity_is_not_rewritten_by_display_escaping(
    identity: str,
) -> None:
    text = ClientToolResult(
        call_id="point", output={"node_key": identity}
    ).as_text()

    assert identity in text


def test_paged_receipt_compacts_repeated_keys_without_losing_ids() -> None:
    output = {
        "items": [
            {
                "node_key": f"water.temperature.{index}",
                "display_name": f"补水温度 {index}",
                "source_name": "联合工房",
                "engineering_unit": "℃",
                "is_enabled": True,
            }
            for index in range(20)
        ],
        "total": 45,
        "has_more": True,
        "next_page": 2,
    }
    text = ClientToolResult(call_id="points", output=output).as_text()

    assert len(text) < len(json.dumps(output, ensure_ascii=False)) * 0.7
    assert all(f"water.temperature.{index}" in text for index in range(20))
    assert "has_more: true" in text
    assert "next_page: 2" in text


def test_long_items_do_not_displace_pagination_and_warning() -> None:
    output = {
        "items": [{"id": "equipment-1", "description": "长" * 30_000}],
        "total": 36,
        "has_more": True,
        "next_page": 2,
        "warnings": ["当前结果为陈旧数据"],
        "is_stale": True,
    }
    text = ClientToolResult(call_id="entities", output=output).as_text()

    assert "has_more: true" in text
    assert "next_page: 2" in text
    assert "当前结果为陈旧数据" in text
    assert "is_stale: true" in text
    assert "截断" in text or "省略" in text
