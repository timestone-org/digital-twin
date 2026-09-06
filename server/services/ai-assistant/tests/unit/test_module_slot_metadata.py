"""子槽配置语义不能在助手目录中丢失。"""

from ai_assistant.apps.chat.services.tools.catalog.modules import detail_of


def test_history_subslot_retains_constraints() -> None:
    got = detail_of(
        {
            "bindings": [
                {
                    "key": "rows",
                    "is_array": True,
                    "array_fields": [
                        {
                            "key": "series",
                            "label": "历史",
                            "data_type": "number",
                            "is_time_series": True,
                            "is_required": True,
                        }
                    ],
                }
            ],
            "content_keys": ["metrics"],
        },
        None,
    )
    field = got["slots"][0]["array_fields"][0]
    assert isinstance(field, dict)
    assert field["is_time_series"] is True
    assert field["is_required"] is True
    assert field["label"] == "历史"
    assert got["content_keys"] == ["metrics"]
