"""助手页面路径的部署前缀适配。"""

import re

from llmcore.skills.routing import RouteBinding
from llmcore.skills.routing import compile_path as compile_shared_path
from llmcore.skills.routing import page_path as shared_page_path


def page_path(given: object) -> str | None:
    return shared_page_path(given, prefix="/ai")


def compile_path(path: str) -> re.Pattern[str]:
    return compile_shared_path(path, prefix="/ai")


__all__ = ["RouteBinding", "compile_path", "page_path"]
