"""DOCX 原件的高保真 PDF 派生物（ADR-0054）。"""

import asyncio
import os
import shutil
import tempfile
import uuid
import xml.etree.ElementTree as ET
import zipfile
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Protocol

from knowledge_server.apps.knowledge.services.parsing import RawItem
from knowledge_server.apps.knowledge.services.sources import (
    preview_key,
    suffix_of,
)
from knowledge_server.settings import MAX_RAW_BYTES
from lib.logging import get_logger
from lib.objectstore import ObjectStore, ObjectStoreError

_logger = get_logger("knowledge.docx_preview")

PDF_MEDIA_TYPE = "application/pdf"
PDF_HEADER = b"%PDF-"
MAX_UNPACKED_BYTES = MAX_RAW_BYTES * 8
MAX_RELATIONSHIP_BYTES = 4 * 1024 * 1024
KILL_GRACE_S = 5.0

_BLOCKED_RELATIONSHIP_SUFFIXES = (
    "/aFChunk",
    "/attachedTemplate",
    "/externalLink",
    "/oleObject",
    "/package",
)
_INHERITED_ENV = (
    "DYLD_LIBRARY_PATH",
    "LD_LIBRARY_PATH",
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "WINDIR",
)


class PreviewRenderFailed(RuntimeError):
    """DOCX 派生预览没能安全地产出。"""


@dataclass(frozen=True)
class PreviewArtifact:
    """一份可直接存储的 PDF 派生物。"""

    content: bytes


class DocumentPreviewer(Protocol):
    """worker 需要的 DOCX 预览派生面。"""

    async def probe(self) -> None: ...

    async def render(self, raw: RawItem) -> PreviewArtifact | None: ...


@dataclass(frozen=True)
class LibreOfficeDocxPreviewer:
    """用无界面的 LibreOffice 把 DOCX 派生为 PDF。"""

    executable: str
    timeout_s: float
    max_output_bytes: int = MAX_RAW_BYTES

    async def probe(self) -> None:
        """启动前确认可执行文件存在。"""
        await asyncio.to_thread(_resolved_command, self.executable)

    async def render(self, raw: RawItem) -> PreviewArtifact | None:
        """DOCX 给 PDF；其它格式不参与。

        Args: raw。
        """
        if suffix_of(raw.filename) != ".docx":
            return None
        with tempfile.TemporaryDirectory(prefix="dt-docx-preview-") as made:
            root = Path(made)
            source = root / "document.docx"
            output = root / "document.pdf"
            await asyncio.to_thread(_write_sanitized_docx, raw.content, source)
            await _run_libreoffice(
                self.executable, source, root, self.timeout_s
            )
            try:
                size = await asyncio.to_thread(lambda: output.stat().st_size)
                if size > self.max_output_bytes:
                    raise PreviewRenderFailed("DOCX 派生 PDF 超过大小上限")
                pdf = await asyncio.to_thread(output.read_bytes)
            except OSError as error:
                raise PreviewRenderFailed("LibreOffice 没有产出 PDF") from error
        return PreviewArtifact(content=_checked_pdf(pdf, self.max_output_bytes))


def build_previewer(
    is_enabled: bool, executable: str, timeout_s: float
) -> DocumentPreviewer | None:
    """按开关装出 DOCX 派生器。

    Args: is_enabled, executable, timeout_s。
    """
    if not is_enabled:
        return None
    return LibreOfficeDocxPreviewer(
        executable=executable.strip(), timeout_s=timeout_s
    )


async def generate_preview(
    previewer: DocumentPreviewer | None,
    store: ObjectStore | None,
    where: tuple[uuid.UUID, uuid.UUID],
    raw: RawItem,
) -> bool:
    """尽力派生并存储预览；附属预览失败不阻断正文摄取。

    Args: previewer, store, where（库 id 与文档 id）, raw。
    """
    if previewer is None or store is None:
        return False
    base_id, document_id = where
    try:
        artifact = await previewer.render(raw)
        if artifact is None:
            return False
        await store.put_bytes(
            preview_key(base_id, document_id),
            artifact.content,
            content_type=PDF_MEDIA_TYPE,
        )
    except (PreviewRenderFailed, ObjectStoreError, OSError) as error:
        _logger.warning(
            "docx_preview_failed",
            "DOCX 预览派生失败，正文摄取继续",
            document_id=str(document_id),
            error=error,
        )
        return False
    return True


def _resolved_command(executable: str) -> str:
    """可执行名或绝对路径 → 已确认存在的绝对路径。

    Args: executable。
    """
    found = shutil.which(executable)
    if found is None:
        raise PreviewRenderFailed(
            "DOCX 派生预览已启用，但找不到 LibreOffice 可执行文件"
        )
    return found


def _write_sanitized_docx(content: bytes, target: Path) -> None:
    """移除宏与会出站的关系，直接写进 Office 临时目录。

    Args: content, target。
    """
    try:
        with zipfile.ZipFile(BytesIO(content)) as source:
            entries = source.infolist()
            if sum(one.file_size for one in entries) > MAX_UNPACKED_BYTES:
                raise PreviewRenderFailed("DOCX 解包后过大，未生成预览")
            _reject_macros(entries)
            with zipfile.ZipFile(
                target,
                "w",
                compression=zipfile.ZIP_DEFLATED,
                compresslevel=6,
            ) as cleaned:
                for entry in entries:
                    _copy_entry(source, cleaned, entry)
    except (zipfile.BadZipFile, RuntimeError) as error:
        if isinstance(error, PreviewRenderFailed):
            raise
        raise PreviewRenderFailed("这份 DOCX 的压缩结构无效") from error


def _copy_entry(
    source: zipfile.ZipFile,
    target: zipfile.ZipFile,
    entry: zipfile.ZipInfo,
) -> None:
    """关系表清洗后写，其余条目流式复制。

    Args: source, target, entry。
    """
    if entry.is_dir():
        return
    copied = zipfile.ZipInfo(entry.filename, date_time=entry.date_time)
    copied.compress_type = entry.compress_type
    copied.create_system = 0
    copied.external_attr = 0x20
    if entry.filename.casefold().endswith(".rels"):
        if entry.file_size > MAX_RELATIONSHIP_BYTES:
            raise PreviewRenderFailed("DOCX 关系表过大")
        target.writestr(copied, _safe_relationships(source.read(entry)))
        return
    with (
        source.open(entry) as opened,
        target.open(copied, "w", force_zip64=True) as written,
    ):
        shutil.copyfileobj(opened, written, length=1024 * 1024)


def _reject_macros(entries: list[zipfile.ZipInfo]) -> None:
    """伪装成 `.docx` 的宏包不交给 Office 进程。

    Args: entries。
    """
    if any(
        one.filename.casefold().endswith("vbaproject.bin") for one in entries
    ):
        raise PreviewRenderFailed("带宏的 Word 文件不生成页面预览")


def _safe_relationships(content: bytes) -> bytes:
    """关系表里移除外链与可执行嵌入。

    Args: content。
    """
    if len(content) > MAX_RELATIONSHIP_BYTES:
        raise PreviewRenderFailed("DOCX 关系表过大")
    declaration_scan = _decoded_xml(content).upper()
    if "<!DOCTYPE" in declaration_scan or "<!ENTITY" in declaration_scan:
        raise PreviewRenderFailed("DOCX 关系表包含不安全的 XML 声明")
    try:
        root = ET.fromstring(  # noqa: S314  # 已拒绝 DTD/ENTITY 且长度有界
            content
        )
    except ET.ParseError as error:
        raise PreviewRenderFailed("DOCX 关系表无效") from error
    removed = False
    for relation in list(root):
        kind = relation.attrib.get("Type", "")
        is_external = (
            relation.attrib.get("TargetMode", "").casefold() == "external"
        )
        if is_external or kind.endswith(_BLOCKED_RELATIONSHIP_SUFFIXES):
            root.remove(relation)
            removed = True
    if not removed:
        return content
    serialized = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    # ⚠ LibreOffice 对关系表的默认命名空间更兼容；元素前缀没有业务含义
    return serialized.replace(b"xmlns:ns0=", b"xmlns=").replace(b"ns0:", b"")


def _decoded_xml(content: bytes) -> str:
    """关系 XML 按 BOM 或四字节前导安全解码。

    Args: content。
    """
    if content.startswith((b"\xff\xfe", b"\xfe\xff")):
        encoding = "utf-16"
    elif content.startswith(b"<\x00"):
        encoding = "utf-16-le"
    elif content.startswith(b"\x00<"):
        encoding = "utf-16-be"
    else:
        encoding = "utf-8-sig"
    try:
        return content.decode(encoding)
    except UnicodeDecodeError as error:
        raise PreviewRenderFailed("DOCX 关系表编码无效") from error


def _office_environment(root: Path) -> dict[str, str]:
    """只给 Office 进程最小环境，不继承服务密钥。

    Args: root（临时 HOME 与 TEMP）。
    """
    inherited = {key.casefold(): value for key, value in os.environ.items()}
    made = {
        key: inherited[key.casefold()]
        for key in _INHERITED_ENV
        if key.casefold() in inherited
    }
    made.update(
        {
            "HOME": str(root),
            "LANG": inherited.get("lang", "C.UTF-8"),
            "LC_ALL": inherited.get("lc_all", "C.UTF-8"),
            "SAL_USE_VCLPLUGIN": "svp",
            "TEMP": str(root),
            "TMP": str(root),
            "TMPDIR": str(root),
            "USERPROFILE": str(root),
        }
    )
    return made


async def _run_libreoffice(
    executable: str, source: Path, output_dir: Path, timeout_s: float
) -> None:
    """无 shell 跑一次转换，超时或取消都杀掉子进程。

    Args: executable, source, output_dir, timeout_s。
    """
    command = await asyncio.to_thread(_resolved_command, executable)
    profile = (output_dir / "profile").as_uri()
    process = await asyncio.create_subprocess_exec(
        command,
        "--headless",
        "--safe-mode",
        "--nologo",
        "--nodefault",
        "--nofirststartwizard",
        "--nolockcheck",
        f"-env:UserInstallation={profile}",
        "--convert-to",
        "pdf:writer_pdf_Export",
        "--outdir",
        str(output_dir),
        str(source),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL,
        env=_office_environment(output_dir),
    )
    try:
        async with asyncio.timeout(timeout_s):
            await process.communicate()
    except TimeoutError:
        await _kill(process)
        raise PreviewRenderFailed("DOCX 预览转换超时") from None
    except asyncio.CancelledError:
        await _kill(process)
        raise
    if process.returncode != 0:
        raise PreviewRenderFailed("LibreOffice 无法转换这份 DOCX")


async def _kill(process: asyncio.subprocess.Process) -> None:
    """杀掉并回收 Office 子进程。

    Args: process。
    """
    if process.returncode is None:
        process.kill()
    try:
        await asyncio.wait_for(process.wait(), KILL_GRACE_S)
    except TimeoutError:
        return


def _checked_pdf(content: bytes, limit: int) -> bytes:
    """只放行有 PDF 头且未越过上限的产物。

    Args: content, limit。
    """
    if not content.startswith(PDF_HEADER):
        raise PreviewRenderFailed("LibreOffice 产出的不是 PDF")
    if len(content) > limit:
        raise PreviewRenderFailed("DOCX 派生 PDF 超过大小上限")
    return content
