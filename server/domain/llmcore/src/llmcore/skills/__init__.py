"""标准技能包的公共接口；业务正文与装配策略由宿主提供。"""

from llmcore.skills.manifest import SkillInstructionsMissing, SkillManifest
from llmcore.skills.registry import SkillCatalog, load_catalog

__all__ = [
    "SkillCatalog",
    "SkillInstructionsMissing",
    "SkillManifest",
    "load_catalog",
]
