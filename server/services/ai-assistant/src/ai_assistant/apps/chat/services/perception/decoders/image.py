"""图片解码器：用户贴进来的图，包成视觉档认的一个图片块。

⚠ **按魔数认，不按后缀认。** 后缀是调用方说了算的：把 `evil.svg` 改名成
`photo.png` 就能绕过一切按后缀的检查，而界面还要给用户看一张缩略图——
那是一条真实的 XSS 路径（svg 能内嵌脚本）。所以白名单判的是**字节开头**。

⚠ 这条判定写在这里而不是前端：前端那道拦不住直接打端点的调用方，而这一路
解出来的东西会原样进模型的图片块、也会原样回给界面渲染。

⚠ 图**只活这一轮**。落库的是一句占位（`perception/vision.PLACEHOLDER`），
不是那几兆字节的 base64——存下来的话，这个会话每重放一次就把它再喂一遍。
跨轮引用要把图落对象存储，那是本解码器之上的另一个实现，本期不做。
"""

import base64
import binascii
from dataclasses import dataclass

from ai_assistant.apps.chat.services.perception.ports import (
    AsImage,
    Decoded,
    UnsupportedInput,
)
from ai_assistant.settings import MAX_IMAGE_CHARS

# 认得的三种，按字节开头判。⚠ 加一种要连魔数一起加：只加后缀等于把白名单
# 退化成后缀检查，而后缀是调用方说了算的
_PNG = b"\x89PNG\r\n\x1a\n"
_JPEG = b"\xff\xd8\xff"
_RIFF = b"RIFF"
_WEBP = b"WEBP"

# svg 单独认出来，为的是能说清**为什么**不收——回一句「认不出的图片格式」
# 会让用户反复换工具重存，而问题不在他那边
_SVG_HEADS = (b"<svg", b"<?xml")


@dataclass(frozen=True)
class ImageDecoder:
    """用户贴图这一路。"""

    @property
    def name(self) -> str:
        """这一路解码器在注册表里的名字。"""
        return "image"

    @property
    def suffixes(self) -> tuple[str, ...]:
        """界面上的 accept 名单用它；真正的判定在 `decode` 里按魔数走。"""
        return (".png", ".jpg", ".jpeg", ".webp")

    @property
    def media_types(self) -> tuple[str, ...]:
        """认得的三种。⚠ 不收 `image/svg+xml`。"""
        return ("image/png", "image/jpeg", "image/webp")

    def decode(self, raw: bytes, filename: str) -> Decoded:
        """认出格式并包成 data URI。

        Args: raw, filename（只进错误话术，不参与判定）。
        """
        media_type = _sniff(raw, filename)
        encoded = base64.b64encode(raw).decode("ascii")
        uri = f"data:{media_type};base64,{encoded}"
        if len(uri) > MAX_IMAGE_CHARS:
            over = (len(uri) - MAX_IMAGE_CHARS) // 1024
            raise UnsupportedInput(
                f"{filename} 太大了，超出上限约 {over} KB；"
                "把图缩小一点或截一小块再贴"
            )
        return AsImage(data_uri=uri, media_type=media_type)


def check_data_uri(uri: str, at: str) -> str:
    """校验一个已经包好的 data URI，回它的 media type。

    ⚠ 存在的理由：用户贴的图**不经过 `attachments:parse`**——那条端点是把文件
    解成文本的，让几兆字节的图上去再原样下来纯属浪费，浏览器手里本来就有那份
    字节。所以白名单必须在收图的那条路上再判一次，而判定要与解码器同一份。

    ⚠ 判的是**解出来的字节**，不是 URI 里声明的那个 media type：声明是调用方
    说了算的，写 `data:image/png;base64,` 再塞一段 svg 是一句话的事。

    Args: uri, at（出错时指得出是第几张图）。
    """
    if len(uri) > MAX_IMAGE_CHARS:
        over = (len(uri) - MAX_IMAGE_CHARS) // 1024
        raise UnsupportedInput(f"{at} 太大了，超出上限约 {over} KB")
    head, _, encoded = uri.partition(",")
    if not head.startswith("data:") or not head.endswith(";base64"):
        raise UnsupportedInput(f"{at} 不是一个 base64 的 data URI")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as error:
        raise UnsupportedInput(f"{at} 的内容不是合法的 base64") from error
    return _sniff(raw, at)


def _sniff(raw: bytes, filename: str) -> str:
    """按字节开头认格式；认不出就抛。

    Args: raw, filename。
    """
    head = raw[:16]
    if head.startswith(_PNG):
        return "image/png"
    if head.startswith(_JPEG):
        return "image/jpeg"
    if head.startswith(_RIFF) and _WEBP in head:
        return "image/webp"
    if any(head.lstrip().startswith(one) for one in _SVG_HEADS):
        raise UnsupportedInput(
            f"{filename} 是 SVG，这里不收：SVG 能内嵌脚本，"
            "而它要在界面上渲染。导成 PNG 再贴"
        )
    raise UnsupportedInput(
        f"{filename} 认不出是哪种图片。只收 PNG / JPEG / WebP"
        "（判的是文件内容，改后缀不作数）"
    )
