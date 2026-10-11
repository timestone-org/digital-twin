"""标准技能包的已校验元数据、正文与宿主集成声明。"""

from dataclasses import dataclass, field
from pathlib import Path


class SkillInstructionsMissing(ValueError):
    """技能缺少可用正文。"""


@dataclass(frozen=True)
class SkillManifest:
    name: str
    title: str
    summary: str
    surface_kinds: tuple[str, ...]
    required_codes: tuple[str, ...] = ()
    server_tools: tuple[str, ...] = ()
    client_tools: tuple[str, ...] = ()
    directory: Path = field(default_factory=Path)
    body: str = ""
    compatibility: str = ""
    resources: tuple[str, ...] = ()

    def instructions(self) -> str:
        """返回启动时校验的正文，模型调用期间不做同步文件 IO。"""
        if not self.body:
            raise SkillInstructionsMissing(f"{self.name} 缺少指令正文")
        return self.body
