"""部署另配的技能目录要一路接通：名册里列出来的，`skills.load` 也要拉得到。

守的是「名册列了、拉取说没有」：模型被告知先 `skills.load` 再动手，拉回一句
「没有名为 X 的技能」，于是整套外置技能看着配上了、实际一个都用不了。
"""

import dataclasses
from pathlib import Path
from typing import cast

from ai_assistant.apps.chat.services.intent import PermissionGate
from ai_assistant.apps.chat.services.tools.providers.server import ServerTools
from ai_assistant.apps.chat.services.tools.registry import (
    ProviderDeps,
    build_registry,
)
from ai_assistant.apps.chat.skills import SkillCatalog, load_catalog
from llmcore.intent.ports import Allowed, TurnContext


def _external(root: Path) -> SkillCatalog:
    directory = root / "ext-skill"
    (directory / "references").mkdir(parents=True)
    (directory / "SKILL.md").write_text(
        "---\nname: ext-skill\ndescription: 外置的一份技能，读参考再动手。\n"
        "---\n\n先读 references/guide.md 再改。\n"
    )
    (directory / "references/guide.md").write_text("第一行\n第二行\n")
    return load_catalog(root)


async def test_an_external_skill_loads_through_the_server_tools(
    tmp_path: Path,
) -> None:
    tools = ServerTools(skills=_external(tmp_path))
    got = await tools("skills.load", {"name": "ext-skill"})
    assert isinstance(got, dict)
    body = cast("dict[str, object]", got)
    assert body["ok"] is True
    assert "references/guide.md" in str(body["instructions"])


async def test_an_external_skill_resource_is_readable(tmp_path: Path) -> None:
    tools = ServerTools(skills=_external(tmp_path))
    got = await tools(
        "skills.read_resource",
        {"name": "ext-skill", "path": "references/guide.md"},
    )
    assert "第二行" in str(got)


async def test_the_registry_hands_the_catalog_to_the_server_tools(
    tmp_path: Path,
) -> None:
    registry = build_registry(ProviderDeps(skills=_external(tmp_path)))
    got = await registry.run("skills.load", {"name": "ext-skill"})
    assert isinstance(got, dict)
    assert got["ok"] is True


async def test_builtin_skills_still_load_without_a_catalog() -> None:
    got = await ServerTools()("skills.load", {"name": "dashboard-binding"})
    assert isinstance(got, dict)
    assert got["ok"] is True


def test_the_permission_gate_knows_external_skills(tmp_path: Path) -> None:
    (skill,) = (
        one for one in _external(tmp_path).skills if one.name == "ext-skill"
    )
    guarded = dataclasses.replace(skill, required_codes=("x:use",))
    got = PermissionGate(skills=(guarded,)).narrow(
        TurnContext(surface_kind="chat", client_tools=None, codes=frozenset()),
        Allowed(tools=frozenset(), skills=frozenset({"ext-skill"})),
    )
    assert got.skills == frozenset()
