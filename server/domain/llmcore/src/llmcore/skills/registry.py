"""组合根显式加载的标准技能目录；可选路径映射与权限决定推荐集合。"""

from dataclasses import dataclass
from pathlib import Path

from pydantic import TypeAdapter

from llmcore.skills.loader import read_skill, read_text
from llmcore.skills.manifest import SkillManifest
from llmcore.skills.routing import (
    RouteBinding,
    compile_path,
    page_path,
)
from llmcore.skills.schemas import (
    SkillIntegration,
    SkillRoutes,
)

MAX_SKILLS = 128


@dataclass(frozen=True)
class SkillCatalog:
    skills: tuple[SkillManifest, ...]
    routes: tuple[RouteBinding, ...]
    path_prefix: str = ""

    def find(self, name: str) -> SkillManifest | None:
        return next(
            (skill for skill in self.skills if skill.name == name), None
        )

    def select(
        self,
        surface_kind: str | None = None,
        path: str | None = None,
        codes: frozenset[str] | None = None,
    ) -> tuple[SkillManifest, ...]:
        """按权限及可选工作面或路径选技能，未指定时使用整个目录。"""
        normalized = page_path(path, prefix=self.path_prefix)
        names = {
            name
            for route in self.routes
            if normalized is not None and route.pattern.fullmatch(normalized)
            for name in route.names
        }
        return tuple(
            skill
            for skill in self.skills
            if (
                skill.name in names
                if path is not None
                else surface_kind is None or surface_kind in skill.surface_kinds
            )
            and (codes is None or set(skill.required_codes) <= codes)
        )


def load_catalog(
    root: Path,
    extra_directory: Path | None = None,
    routes_file: Path | None = None,
    path_prefix: str = "",
    *,
    should_include_routes: bool = True,
) -> SkillCatalog:
    """启动时加载内建包及可选本地包。Args: extra_directory, routes_file。"""
    integrations = TypeAdapter(list[SkillIntegration]).validate_json(
        read_text(root / "integrations.json", 128_000)
    )
    by_name = {item.name: item for item in integrations}
    roots = (root / "library",) + (
        (extra_directory,) if extra_directory else ()
    )
    skills: dict[str, SkillManifest] = {}
    for directory_root in roots:
        if not directory_root.is_dir():
            raise ValueError(f"技能目录不存在：{directory_root}")
        for directory in sorted(directory_root.iterdir()):
            if directory.name.startswith(".") or not directory.is_dir():
                continue
            if directory.is_symlink():
                raise ValueError("技能目录不支持符号链接")
            skill = read_skill(directory, by_name.get(directory.name))
            if skill.name in skills:
                raise ValueError(f"技能名称重复：{skill.name}")
            skills[skill.name] = skill
            if len(skills) > MAX_SKILLS:
                raise ValueError(f"技能数量超过 {MAX_SKILLS}")
    files = (
        (root / "routes.json",) + ((routes_file,) if routes_file else ())
        if should_include_routes
        else ()
    )
    routes = tuple(
        binding
        for path in files
        for binding in _bindings(path, set(skills), path_prefix)
    )
    return SkillCatalog(
        tuple(skills[name] for name in sorted(skills)), routes, path_prefix
    )


def _bindings(
    path: Path, names: set[str], prefix: str
) -> tuple[RouteBinding, ...]:
    config = SkillRoutes.model_validate_json(read_text(path, 128_000))
    bindings: list[RouteBinding] = []
    for route in config.routes:
        unknown = set(route.skills) - names
        if unknown:
            raise ValueError(
                f"路径映射引用了不存在的技能：{', '.join(sorted(unknown))}"
            )
        bindings.extend(
            RouteBinding(compile_path(item, prefix=prefix), tuple(route.skills))
            for item in route.paths
        )
    return tuple(bindings)
