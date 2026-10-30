"""Word 导入的安全错误消息在真实子进程边界保持可操作。"""

import io
import zipfile

import pytest
from docx import Document
from unit.report.docx_import_fakes import payload

from platform_server.apps.report.errors import ReportInvalid
from platform_server.apps.report.services import word_task
from platform_server.apps.report.services.word_task import WordTask, run_task
from platform_server.apps.report.services.worker import WordPool


def macro_document():
    output = io.BytesIO()
    with (
        zipfile.ZipFile(io.BytesIO(payload(Document()))) as source,
        zipfile.ZipFile(output, "w") as target,
    ):
        for entry in source.infolist():
            target.writestr(entry, source.read(entry))
        target.writestr("word/vbaProject.bin", b"inactive-test-fixture")
    return output.getvalue()


@pytest.mark.parametrize("source", [b"not a Word document", b"PK-invalid-zip"])
def test_corrupt_word_has_safe_actionable_error(source):
    with pytest.raises(ReportInvalid, match=r"Word 文件.*损坏"):
        run_task(WordTask(source=source))


def test_internal_parser_errors_never_expose_paths_or_external_addresses(
    monkeypatch,
):
    def invalid_parser(_source):
        raise ValueError(
            "internal http://private.test Authorization=private-value"
        )

    monkeypatch.setattr(word_task, "import_docx", invalid_parser)
    with pytest.raises(ReportInvalid, match=r"Word 文件.*损坏") as caught:
        run_task(WordTask(source=b"fixture"))
    assert "private" not in str(caught.value)
    assert caught.value.code == 41303


@pytest.mark.parametrize(
    ("source", "message"),
    [(b"broken", "Word 文件"), (macro_document(), "宏")],
    ids=["damaged", "macro"],
)
async def test_import_error_message_survives_real_word_process(source, message):
    pool = WordPool()
    try:
        with pytest.raises(ReportInvalid, match=message):
            await pool.run(WordTask(source=source), 15)
    finally:
        pool.close()
