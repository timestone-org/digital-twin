"""不含查询参数的页面路径与技能映射。"""

import re
from dataclasses import dataclass

MAX_PAGE_PATH_CHARS = 2048
FIRST_PRINTABLE_CODE = 32


def page_path(given: object, *, prefix: str = "") -> str | None:
    """只接受应用内路径并去掉部署前缀。Args: given。"""
    if not isinstance(given, str) or not given.startswith("/"):
        return None
    path = given.split("?", 1)[0].split("#", 1)[0]
    if path.startswith("//") or "\\" in path or len(path) > MAX_PAGE_PATH_CHARS:
        return None
    if any(ord(char) < FIRST_PRINTABLE_CODE for char in path):
        return None
    if any(part in {".", ".."} for part in path.split("/")):
        return None
    if prefix and (path == prefix or path.startswith(prefix + "/")):
        path = path[len(prefix) :] or "/"
    return path.rstrip("/") or "/"


@dataclass(frozen=True)
class RouteBinding:
    pattern: re.Pattern[str]
    names: tuple[str, ...]


def compile_path(path: str, *, prefix: str = "") -> re.Pattern[str]:
    """路径支持 :参数、单段 * 与末尾 **。Args: path。"""
    normalized = page_path(path, prefix=prefix)
    if normalized is None or "?" in path or "#" in path:
        raise ValueError(f"技能映射路径无效：{path}")
    segments = normalized.lstrip("/").split("/")
    parts: list[str] = []
    for index, segment in enumerate(segments):
        if segment == "**":
            if index != len(segments) - 1:
                raise ValueError("技能路径的 ** 只能放在末尾")
            parts.append("(?:/.*)?")
        elif segment == "*" or re.fullmatch(r":[A-Za-z][A-Za-z0-9_]*", segment):
            parts.append("/[^/]+")
        elif "*" in segment or ":" in segment:
            raise ValueError(f"技能映射路径片段无效：{segment}")
        else:
            parts.append("/" + re.escape(segment))
    return re.compile("^" + "".join(parts) + "$")
