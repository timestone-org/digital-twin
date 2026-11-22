"""确认素材类型与对象内容前缀一致。"""

import json
from struct import Struct
from typing import cast
from xml.parsers import expat

from lib.objectstore import (
    ObjectChanged,
    ObjectNotFound,
    ObjectStat,
    ObjectStore,
    ObjectStoreError,
)
from platform_server.apps.assets.errors import (
    AssetStoreUnavailable,
    AssetTypeRejected,
    AssetUploadMissing,
)

HEADER_BYTES = 16 * 1024
_GLB_HEADER = Struct("<4sIII4s")
_GLB_VERSION = 2
_SVG_ROOTS = frozenset({"svg", "http://www.w3.org/2000/svg}svg"})


async def check_upload_content(store: ObjectStore, stat: ObjectStat) -> None:
    """有界读取指定版本并核对文件格式。Args: store, stat。"""
    if stat.size_bytes == 0:
        raise AssetUploadMissing("上传文件为空，请重新上传")
    try:
        prefix = await store.read_prefix(
            stat.key, max_bytes=HEADER_BYTES, expected_etag=stat.etag
        )
    except (ObjectChanged, ObjectNotFound) as error:
        raise AssetUploadMissing("上传内容发生变化，请重新上传") from error
    except ObjectStoreError as error:
        raise AssetStoreUnavailable("素材服务暂时不可用") from error
    if len(prefix) != min(stat.size_bytes, HEADER_BYTES):
        raise AssetUploadMissing("上传文件不完整，请重新上传")
    if not _has_format(prefix, stat):
        raise AssetTypeRejected("文件内容与声明的素材类型不符")


def _has_format(prefix: bytes, stat: ObjectStat) -> bool:
    """识别目录允许的素材格式。Args: prefix, stat。"""
    match stat.content_type:
        case "image/png":
            return prefix.startswith(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR")
        case "image/jpeg":
            return prefix.startswith(b"\xff\xd8\xff")
        case "image/webp":
            return _is_webp(prefix, stat.size_bytes)
        case "image/svg+xml":
            return _is_svg(prefix)
        case _:
            return _has_model_format(prefix, stat)


def _has_model_format(prefix: bytes, stat: ObjectStat) -> bool:
    """识别两种模型封装及浏览器类型兜底。Args: prefix, stat。"""
    match stat.content_type:
        case "model/gltf-binary":
            return _is_glb(prefix, stat.size_bytes)
        case "model/gltf+json":
            return _is_gltf_json(prefix, stat.size_bytes)
        case "application/octet-stream":
            return _is_glb(prefix, stat.size_bytes) or _is_gltf_json(
                prefix, stat.size_bytes
            )
        case _:
            return False


def _is_webp(prefix: bytes, size_bytes: int) -> bool:
    """核对 WebP 的 RIFF 签名及长度。Args: prefix, size_bytes。"""
    return (
        prefix.startswith(b"RIFF")
        and prefix[8:12] == b"WEBP"
        and int.from_bytes(prefix[4:8], "little") + 8 == size_bytes
    )


def _is_glb(prefix: bytes, size_bytes: int) -> bool:
    """核对 GLB 2 的容器头与首个 JSON 块。Args: prefix, size_bytes。"""
    offset = _GLB_HEADER.size
    if len(prefix) < offset:
        return False
    magic, version, total, length, chunk = _GLB_HEADER.unpack_from(prefix)
    if (
        magic != b"glTF"
        or version != _GLB_VERSION
        or total != size_bytes
        or chunk != b"JSON"
        or length == 0
        or length % 4 != 0
        or offset + length > total
    ):
        return False
    return _is_gltf_json(prefix[offset : offset + length], length)


def _is_gltf_json(prefix: bytes, size_bytes: int) -> bool:
    """小文件核对 asset.version，大文件核对 JSON 对象头。

    Args: prefix, size_bytes。
    """
    if not prefix.removeprefix(b"\xef\xbb\xbf").lstrip().startswith(b"{"):
        return False
    # JSON 属性无顺序约定，asset 可以在大文件的前缀之外。
    if len(prefix) < size_bytes:
        return True
    try:
        doc: object = json.loads(prefix)
    except (ValueError, RecursionError):
        return False
    if not isinstance(doc, dict):
        return False
    asset = cast(dict[str, object], doc).get("asset")
    if not isinstance(asset, dict):
        return False
    version = cast(dict[str, object], asset).get("version")
    return isinstance(version, str) and bool(version.strip())


class _XmlRoot(Exception):
    """终止 XML 前缀解析并记录根名。"""

    def __init__(self, name: str) -> None:
        super().__init__(name)
        self.name = name


def _is_svg(prefix: bytes) -> bool:
    """用有限前缀识别 SVG 根元素。Args: prefix。"""

    def capture(name: str, _attributes: dict[str, str]) -> None:
        raise _XmlRoot(name)

    def reject_entity(*_declaration: object) -> None:
        raise ValueError("不解析 XML 实体")

    parser = expat.ParserCreate(namespace_separator="}")
    parser.StartElementHandler = capture
    parser.EntityDeclHandler = reject_entity
    try:
        parser.Parse(prefix, False)
    except _XmlRoot as root:
        return root.name in _SVG_ROOTS
    except (expat.ExpatError, ValueError):
        return False
    return False
