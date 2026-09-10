"""页面预览的两种二进制 MIME 必须写进 OpenAPI，供前端可靠分派。"""

import json
from pathlib import Path

DOCX_MEDIA_TYPE = (
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
)


def test_preview_declares_pdf_and_docx_binary_responses() -> None:
    schema = json.loads(
        (Path(__file__).parents[2] / "openapi.json").read_text(encoding="utf-8")
    )
    content = schema["paths"][
        "/api/v1/knowledge/documents/{document_id}/preview"
    ]["get"]["responses"]["200"]["content"]

    assert set(content) == {"application/pdf", DOCX_MEDIA_TYPE}
    assert all(
        one["schema"] == {"format": "binary", "type": "string"}
        for one in content.values()
    )
