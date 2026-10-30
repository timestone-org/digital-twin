"""报告子进程的纯输入输出。"""

from dataclasses import dataclass
from zipfile import BadZipFile

from platform_server.apps.report.errors import ReportInvalid
from platform_server.apps.report.schemas.jobs import ImportResultOut
from platform_server.apps.report.schemas.preview import PreviewOut
from platform_server.apps.report.schemas.template import TemplateBody
from platform_server.apps.report.services.docx_builder import build_docx
from platform_server.apps.report.services.docx_import import (
    WordImportInvalid,
    import_docx,
)


@dataclass(frozen=True)
class WordTask:
    """二进制导入或模板生成。"""

    template: TemplateBody | None = None
    preview: PreviewOut | None = None
    source: bytes | None = None


@dataclass(frozen=True)
class WordTaskResult:
    """可回传父进程的结果。"""

    payload: bytes | None
    warnings: tuple[str, ...]
    imported: ImportResultOut | None = None


def run_task(task: WordTask) -> WordTaskResult:
    if task.source is not None:
        return _import(task.source)
    if task.template is None or task.preview is None:
        raise ValueError("生成任务缺少模板或试算结果")
    generated = build_docx(task.template, task.preview)
    return WordTaskResult(
        payload=generated.payload, warnings=generated.warnings
    )


def _import(source: bytes) -> WordTaskResult:
    try:
        imported = import_docx(source)
    except WordImportInvalid as error:
        raise ReportInvalid(str(error)) from None
    except (
        BadZipFile,
        SyntaxError,
        ValueError,
        KeyError,
        TypeError,
        AttributeError,
        IndexError,
        RuntimeError,
    ):
        raise ReportInvalid(
            "Word 文件已损坏或包含不支持的内容，请核对文件后重新导入"
        ) from None
    return WordTaskResult(
        payload=None, warnings=tuple(imported.dropped), imported=imported
    )
