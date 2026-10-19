"""图文档拒绝路径和案例兼容性。"""

import base64

import pytest
from pydantic import ValidationError

from hierarchy_server.apps.projects.schemas.graph import HierarchyDocument
from hierarchy_server.apps.projects.services.projects import decode_cursor
from lib.errors import ValidationFailed


def test_reference_preserves_all_elements(document):
    assert len(document.nodes) == 34
    assert sum(node.kind == "meter" for node in document.nodes) == 33
    assert len(document.edges) == 33
    assert document.paper.width == 1516


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("schemaVersion", 2),
        ("templateId", "other"),
        ("title", " "),
        ("paper", {"width": 359}),
        ("paper", {"width": 12001}),
        ("viewport", {"x": 0, "y": 0, "zoom": 0}),
    ],
)
def test_document_rejects_invalid_fields(document, field, value):
    payload = document.model_dump(by_alias=True)
    payload[field] = value
    with pytest.raises(ValidationError):
        HierarchyDocument.model_validate(payload)


@pytest.mark.parametrize(
    "kind", ["id", "code", "edge", "self", "missing", "cycle", "junction"]
)
def test_graph_rejects_invalid_relationships(document, kind):
    payload = document.model_dump(by_alias=True)
    nodes, edges = payload["nodes"], payload["edges"]
    if kind in ("id", "code"):
        nodes[1][kind] = nodes[0][kind]
    if kind == "edge":
        edges.append(edges[0])
    if kind == "self":
        edges[0]["target"] = edges[0]["source"]
    if kind == "missing":
        edges[0]["target"] = "missing"
    if kind == "cycle":
        edges.append({"id": "cycle", "source": "m1", "target": "s1"})
    if kind == "junction":
        nodes[0]["kind"] = "junction"
        edges.append({"id": "junction", "source": "s1", "target": "bus"})
    with pytest.raises(ValidationError):
        HierarchyDocument.model_validate(payload)


@pytest.mark.parametrize(
    "cursor", ["invalid", "cmV2aXNpb246MA==", "Zm9vOjI=", "!!!!"]
)
def test_invalid_history_cursor_is_a_client_error(cursor):
    with pytest.raises(ValidationFailed):
        decode_cursor(cursor)


def test_history_cursor_is_opaque():
    assert decode_cursor(None) is None
    assert decode_cursor("cmV2aXNpb246Mg==") == 2


def test_cursor_rejects_revision_outside_database_range():
    cursor = base64.b64encode(b"revision:99999999999999999").decode()
    with pytest.raises(ValidationFailed):
        decode_cursor(cursor)
