"""知识库单入口的固定标准技能目录。"""

from functools import cache
from pathlib import Path

from llmcore.skills import SkillCatalog
from llmcore.skills import load_catalog as load_shared_catalog

ROOT = Path(__file__).resolve().parent


def load_catalog(extra_directory: Path | None = None) -> SkillCatalog:
    return load_shared_catalog(
        ROOT, extra_directory, should_include_routes=False
    )


@cache
def default_catalog() -> SkillCatalog:
    return load_catalog()
