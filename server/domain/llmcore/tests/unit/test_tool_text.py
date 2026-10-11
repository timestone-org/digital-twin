"""工具文本保留字段、分页语义与预算边界。"""

import json
from decimal import Decimal

import pytest

from llmcore.output.tool_text import format_tool_output


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (True, "true"),
        (False, "false"),
        (None, "null"),
        (123456789012345678901234567890, "123456789012345678901234567890"),
        (
            Decimal("0.123456789012345678901234567890"),
            "0.123456789012345678901234567890",
        ),
        ("# 技能\n\n- 保留 **原文**", "# 技能\n\n- 保留 **原文**"),
    ],
    ids=["true", "false", "null", "integer", "decimal", "plain-text"],
)
def test_preserves_scalar_values(value: object, expected: str) -> None:
    assert format_tool_output(value) == expected


def test_compacts_repeated_records_without_losing_fields() -> None:
    value = {
        "items": [
            {
                "point_id": f"018e53af-7111-7000-8000-{index:012d}",
                "name": f"温度测点{index}",
                "value": Decimal("12.345678901234567890"),
                "enabled": True,
            }
            for index in range(20)
        ],
        "total": 120,
        "has_more": True,
        "next_page": 2,
    }
    output = format_tool_output(value)
    assert output.count("point_id") == 1
    assert output.count("018e53af-7111-7000-8000-") == 20
    assert "12.345678901234567890" in output
    assert "has_more: true" in output
    assert "next_page: 2" in output
    assert len(output) < len(json.dumps(value, default=str, indent=2)) * 0.7


def test_preserves_metadata_before_omitting_complete_rows() -> None:
    value = {
        "items": [
            {"id": f"stable-id-{index}", "value": "x" * 90}
            for index in range(30)
        ],
        "total": 30,
        "has_more": True,
        "next_cursor": "cursor-complete-12345",
        "warnings": ["部分值陈旧"],
        "is_stale": True,
    }
    output = format_tool_output(value, max_chars=500)
    assert len(output) <= 500
    assert 'next_cursor: "cursor-complete-12345"' in output
    assert "has_more: true" in output
    assert "部分值陈旧" in output
    assert "is_stale: true" in output
    assert "省略" in output
    assert "分页" in output
    assert all(
        f'stable-id-{index}"' in output
        for index in range(output.count("stable-id-"))
    )


@pytest.mark.parametrize(
    "max_chars",
    [-1, 0, 1, 2, 5, 20, 80, 150],
    ids=[
        "negative",
        "zero",
        "one",
        "two",
        "five",
        "twenty",
        "eighty",
        "one-fifty",
    ],
)
def test_never_exceeds_even_tiny_budget(max_chars: int) -> None:
    output = format_tool_output({"items": [{"id": "x" * 1000}]}, max_chars)
    assert len(output) <= max(0, max_chars)
    if max_chars > 0:
        assert "…" in output


def test_marks_long_values_without_hiding_pagination() -> None:
    output = format_tool_output(
        {"body": "x" * 3000, "next_page": 3, "has_more": True}, 180
    )
    assert "next_page: 3" in output
    assert "has_more: true" in output
    assert "截断" in output
    assert len(output) <= 180


def test_fences_unsafe_values_without_rewriting_their_content() -> None:
    output = format_tool_output(
        {
            "items": [
                {"id": "a|b", "text": "<script>\n- **attack**"},
                {"id": "c", "text": "[link](https://example.test)"},
            ]
        }
    )
    assert '"a|b"' in output
    assert "<script>\n- **attack**" in output
    assert '"[link](https://example.test)"' in output
    assert "```" in output
    assert "&lt;script&gt;" not in output
    assert "| id |" not in output


def test_handles_nested_objects_and_heterogeneous_lists() -> None:
    output = format_tool_output(
        {
            "data": {
                "items": [{"id": "one"}, {"id": "two", "extra": None}],
                "empty": [],
                "settings": {"value": False},
            },
            "errors": ["unavailable"],
        }
    )
    assert "one" in output
    assert "two" in output
    assert "extra: null" in output
    assert "value: false" in output
    assert "empty: []" in output
    assert "unavailable" in output


def test_marks_excessive_depth_and_cycles() -> None:
    nested: dict[str, object] = {"leaf": "value"}
    for _ in range(1000):
        nested = {"child": nested}
    output = format_tool_output(nested, 500)
    assert "深度" in output
    assert len(output) <= 500
    cycle: dict[str, object] = {}
    cycle["cycle"] = cycle
    assert "深度" in format_tool_output(cycle)


def test_distinguishes_empty_collections_and_string_literals() -> None:
    output = format_tool_output(
        {"empty_object": {}, "empty_list": [], "text": "true", "boolean": True}
    )
    assert "empty_object: {}" in output
    assert "empty_list: []" in output
    assert 'text: "true"' in output
    assert "boolean: true" in output


def test_preserves_identifiers_without_unnecessary_markdown_escapes() -> None:
    identifier = "plant.area_1/device_2/018e53af-7111-7000-8000-000000000001"
    output = format_tool_output({"id": identifier, "next_cursor": identifier})
    assert output.count(identifier) == 2


def test_preserves_multiline_body_inside_safe_fences() -> None:
    body = '# 技能说明\n\n- **步骤**\n```json\n{"a": true}\n```\n<script>'
    output = format_tool_output({"instructions": body, "name": "analysis"})
    assert body in output
    assert "instructions:\n````\n" in output
    assert output.endswith("\n````")


def test_preserves_mapping_with_non_string_keys() -> None:
    output = format_tool_output([{1: "one"}, {1: "two"}])
    assert '1: "one"' in output
    assert '1: "two"' in output


def test_escapes_control_characters_in_field_names() -> None:
    output = format_tool_output({"field\n- fake": "real"})
    assert "field\\n- fake" in output
    assert "\n- fake" not in output


@pytest.mark.parametrize(
    "identifier",
    [
        r"plant.A[1]&B|temperature\raw",
        "https://example.test/api?a=1&filter[]=two#section",
        "[sensor_1] * 2 + max(a, b) < 20",
        r"C:\plant\models\pump_1.glb",
        "plant.area_1/device_2/id`part",
    ],
    ids=["node-key", "url", "formula", "windows-path", "backtick"],
)
def test_preserves_special_values_with_standard_scalar_encoding(
    identifier: str,
) -> None:
    encoded = json.dumps(identifier, ensure_ascii=False)
    output = format_tool_output({"node_key": identifier})
    assert encoded in output
    assert "```" in output


def test_omits_long_cursor_atomically_and_preserves_other_metadata() -> None:
    cursor = "cursor-unique-prefix-" + "x" * 1000
    output = format_tool_output(
        {
            "items": [{"id": "one"}],
            "next_cursor": cursor,
            "total": 1,
            "has_more": True,
        },
        max_chars=200,
    )
    assert "next_cursor:" in output
    assert "完整值" in output
    assert "cursor-unique-prefix-" not in output
    assert "has_more: true" in output
    assert "total: 1" in output
    assert len(output) <= 200


def test_omits_long_identity_without_producing_a_partial_identifier() -> None:
    identity = "never-copy-partial-" + "x" * 1000
    output = format_tool_output({"node_key": identity, "success": False}, 150)
    assert "node_key:" in output
    assert "完整值" in output
    assert "never-copy-partial-" not in output
    assert "success: false" in output


@pytest.mark.parametrize(
    ("value", "expected"),
    [({}, "{}"), ([], "[]"), ([1, False, None], "- 1\n- false\n- null")],
    ids=["empty-object", "empty-list", "primitive-list"],
)
def test_preserves_root_collections(value: object, expected: str) -> None:
    assert format_tool_output(value) == expected


def test_formats_mixed_records_and_nested_collections() -> None:
    output = format_tool_output([{"id": "one"}, 2, [3, None], "<html>"])
    assert 'id: "one"' in output
    assert "- 2" in output
    assert "[3; null]" in output
    assert '"<html>"' in output
    assert "```" in output


def test_handles_table_headers_and_field_labels_larger_than_budget() -> None:
    key = "field" * 300
    output = format_tool_output([{key: "one"}, {key: "two"}], 200)
    assert "省略 2 项" in output
    output = format_tool_output({key: {"total": 2}, "has_more": False}, 150)
    assert "省略 1 个字段" in output
    assert "has_more: false" in output


def test_handles_unsafe_column_names_without_rewriting_values() -> None:
    output = format_tool_output([{"a|b": "one"}, {"a|b": "two"}])
    assert "a|b" in output
    assert '"one"' in output
    assert '"two"' in output
    assert "| --- |" not in output


def test_truncates_multiline_descriptions_and_omits_them_when_too_small() -> (
    None
):
    body = "line\n" * 300
    output = format_tool_output({"description": body, "total": 1}, 200)
    assert "description:" in output
    assert "截断" in output
    assert "total: 1" in output
    assert len(output) <= 200
    output = format_tool_output({"description": body, "total": 1}, 60)
    assert "省略" in output
    assert len(output) <= 60


def test_omits_multiline_identity_atomically() -> None:
    identifier = "identity-prefix\n" + "x" * 2000
    output = format_tool_output({"node_key": identifier, "has_more": True}, 180)
    assert "完整值" in output
    assert "identity-prefix" not in output
    assert "has_more: true" in output


def test_respects_every_budget_across_row_omission_boundaries() -> None:
    value = {
        "items": [{"id": f"id-{index}"} for index in range(50)],
        "total": 50,
        "has_more": True,
        "next_page": 2,
    }
    for limit in range(1, 400):
        output = format_tool_output(value, limit)
        assert len(output) <= limit
        if "id-" in output:
            assert all(
                f'"id-{index}"' in output
                for index in range(output.count("id-"))
            )


def test_truncates_plain_text_at_tiny_budget() -> None:
    assert format_tool_output("large body", 1) == "…"


def test_marks_deep_nested_sequence_values() -> None:
    nested: object = "leaf"
    for _ in range(1000):
        nested = [nested]
    output = format_tool_output([nested], 500)
    assert "深度" in output
    assert len(output) <= 500


def test_omits_oversized_inline_collections_explicitly() -> None:
    output = format_tool_output([["x" * 1000, "second"]], 200)
    assert "省略" in output
    assert len(output) <= 200


def test_protects_identifier_underscores_with_code_without_losing_tables() -> (
    None
):
    value = {
        "items": [
            {"node_key": "source:PLC_channel_12", "value": 1},
            {"node_key": "source:PLC_channel_13", "value": 2},
        ]
    }
    output = format_tool_output(value)
    assert "| `node_key` | value |" in output
    assert '`"source:PLC_channel_12"`' in output
    assert '`"source:PLC_channel_13"`' in output
    assert "| --- | --- |" in output


def test_protects_multiple_underscores_and_backticks_in_field_names() -> None:
    output = format_tool_output({"one_two_three": "value", "key`with`code": 1})
    assert '`one_two_three`: "value"' in output
    assert "``key`with`code``: 1" in output


def test_protects_mapping_identifier_with_inline_code() -> None:
    assert format_tool_output({"node_key": "source:PLC_channel_12"}) == (
        'node_key: `"source:PLC_channel_12"`'
    )
