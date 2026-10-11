"""助手技能目录的显式装配与进程内不可变快照。"""

from functools import cache
from pathlib import Path

from llmcore.skills import SkillCatalog
from llmcore.skills import load_catalog as load_shared_catalog

BUILTIN_ROOT = Path(__file__).resolve().parent


def load_catalog(
    extra_directory: Path | None = None, routes_file: Path | None = None
) -> SkillCatalog:
    return load_shared_catalog(
        BUILTIN_ROOT, extra_directory, routes_file, path_prefix="/ai"
    )


@cache
def default_catalog() -> SkillCatalog:
    return load_catalog()
