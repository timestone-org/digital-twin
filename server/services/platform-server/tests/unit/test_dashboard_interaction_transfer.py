"""大屏包的联动引用、旧节点补选与可移植键。"""

import uuid

import pytest

from platform_server.apps.dashboard.errors import ExportPayloadInvalid
from platform_server.apps.dashboard.services.interaction_transfer import (
    export_node_references,
    import_node_references,
)


def test_tagged_keys_round_trip_without_changing_extensions_or_the_source() -> (
    None
):
    node = uuid.uuid4()
    target = uuid.uuid4()
    original = {
        "chrome": {"nodeId": str(node)},
        "interactions": [
            {
                "source": {"nodeId": str(node)},
                "action": {"type": "future", "targets": [str(node)]},
            }
        ],
    }
    portable = export_node_references(original, {node: str(node)})
    rule = portable["interactions"][0]
    assert rule["source"]["nodeId"] == {"client_key": str(node)}
    assert rule["action"] == original["interactions"][0]["action"]
    bound = import_node_references(portable, {str(node): target}, None)
    assert bound["interactions"][0]["source"]["nodeId"] == str(target)
    assert original["interactions"][0]["source"]["nodeId"] == str(node)
    assert bound["chrome"] == original["chrome"]


@pytest.mark.parametrize("form", ["hex", "upper", "urn", "braces"])
def test_uuid_shaped_legacy_keys_require_a_choice_even_when_a_key_matches(
    form: str,
) -> None:
    old = uuid.uuid4()
    value = {
        "hex": old.hex,
        "upper": str(old).upper(),
        "urn": old.urn,
        "braces": "{" + str(old) + "}",
    }[form]
    doc = {"interactions": [{"source": {"nodeId": value}}]}
    target = uuid.uuid4()
    with pytest.raises(ExportPayloadInvalid) as error:
        import_node_references(doc, {value: target}, {})
    assert [d.code for d in error.value.details] == [
        "interaction_node_mapping_required"
    ]
    chosen = import_node_references(doc, {"panel": target}, {value: "panel"})
    assert chosen["interactions"][0]["source"]["nodeId"] == str(target)


def test_unique_plain_key_and_unknown_choice() -> None:
    target = uuid.uuid4()
    chrome = {
        "interactions": [{"action": {"type": "openModal", "target": "panel"}}]
    }
    bound = import_node_references(chrome, {"panel": target}, {})
    assert bound["interactions"][0]["action"]["target"] == str(target)
    with pytest.raises(ExportPayloadInvalid) as error:
        import_node_references(
            chrome,
            {"panel": target},
            {"panel": "other"},
        )
    assert error.value.details[0].code == "interaction_node_choice_unused"


def test_all_bad_references_report_their_field_paths() -> None:
    chrome = {
        "interactions": [
            {
                "source": {"nodeId": None},
                "action": {
                    "type": "show",
                    "targets": [
                        {"client_key": 12},
                        {"client_key": "absent"},
                        {"client_key": "panel", "extra": 1},
                    ],
                },
            }
        ]
    }
    with pytest.raises(ExportPayloadInvalid) as error:
        import_node_references(chrome, {"panel": uuid.uuid4()}, {})
    assert [(d.field, d.code) for d in error.value.details] == [
        (
            "chrome_json.interactions[0].source.nodeId",
            "interaction_node_reference_invalid",
        ),
        (
            "chrome_json.interactions[0].action.targets[0]",
            "interaction_node_reference_invalid",
        ),
        (
            "chrome_json.interactions[0].action.targets[1]",
            "interaction_node_key_unknown",
        ),
        (
            "chrome_json.interactions[0].action.targets[2]",
            "interaction_node_reference_invalid",
        ),
    ]


def test_export_reports_a_deleted_interaction_source() -> None:
    chrome = {"interactions": [{"source": {"nodeId": str(uuid.uuid4())}}]}
    with pytest.raises(ExportPayloadInvalid) as error:
        export_node_references(chrome, {})
    assert error.value.details[0].code == "interaction_node_not_found"


@pytest.mark.parametrize("extra", [{"panel": "other"}, {"unused": "missing"}])
def test_choices_only_apply_to_ambiguous_references(
    extra: dict[str, str],
) -> None:
    chrome = {"interactions": [{"source": {"nodeId": "panel"}}]}
    keys = {"panel": uuid.uuid4(), "other": uuid.uuid4()}
    with pytest.raises(ExportPayloadInvalid) as error:
        import_node_references(chrome, keys, extra)
    assert error.value.details[0].field.startswith("interaction_node_map")


@pytest.mark.parametrize(
    ("action", "path"),
    [
        ({"type": "show", "targets": "panel"}, "targets"),
        ({"type": "setActive", "groups": {}}, "groups"),
        (
            {"type": "setActive", "groups": [{"targets": None}]},
            "groups[0].targets",
        ),
        ({"type": "openModal"}, "target"),
    ],
)
def test_malformed_local_action_fields_fail_before_import(
    action: dict[str, object], path: str
) -> None:
    chrome = {"interactions": [{"action": action}]}
    with pytest.raises(ExportPayloadInvalid) as error:
        import_node_references(chrome, {}, {})
    assert (
        error.value.details[0].field
        == "chrome_json.interactions[0].action." + path
    )
