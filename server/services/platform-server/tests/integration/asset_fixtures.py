"""面向素材确认测试的标准小文件。"""

import json
from base64 import b64decode
from struct import pack

PNG = b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQitn5"
    "HwAEEgI3SPNXmQAAAABJRU5ErkJggg=="
)
JPEG = b64decode(
    "/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAA"
    "AAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAaADAAQAAAABAAAAAQAAAAD/"
    "7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBO"
    "mACZjs+EJ+/8AAEQgAAQABAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAAB"
    "AgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicR"
    "QygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RV"
    "VldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7"
    "S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8B"
    "AAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdw"
    "ABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJico"
    "KSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJip"
    "KTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm"
    "5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICA"
    "gICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PD//bAEMBAgICBAQEBwQEBxAL"
    "CQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB"
    "AQEP/dAAQAAf/aAAwDAQACEQMRAD8A+U6KKK/uA/ms/9k="
)
WEBP = b64decode("UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAdQroo0t/+BiOh/AAA=")
SVG = (
    b'<?xml version="1.0"?>\n<!-- fixture -->\n'
    b'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1">'
    b'<path d="M0 0h1v1H0z" fill="blue"/></svg>'
)


def gltf_bytes(name: str) -> bytes:
    """一份不依赖外部资源的模型。Args: name。"""
    return json.dumps(
        {
            "asset": {"version": "2.0"},
            "scene": 0,
            "scenes": [{"nodes": [0]}],
            "nodes": [{"name": name}],
        },
        separators=(",", ":"),
    ).encode()


def glb_bytes(name: str) -> bytes:
    """带标准容器头及对齐 JSON 块的模型。Args: name。"""
    payload = gltf_bytes(name)
    aligned = payload.ljust((len(payload) + 3) & ~3, b" ")
    return (
        pack("<4sIII4s", b"glTF", 2, 20 + len(aligned), len(aligned), b"JSON")
        + aligned
    )
