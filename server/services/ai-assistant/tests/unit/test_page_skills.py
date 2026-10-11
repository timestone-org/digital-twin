"""标准技能目录、页面路由与权限共同决定模型可见的技能。"""

import json
from pathlib import Path

import pytest

from ai_assistant.apps.chat.services.advance_service import (
    AdvanceInput,
    assemble,
)
from ai_assistant.apps.chat.services.memory.page_context import snapshot_of
from ai_assistant.apps.chat.services.tools.skill_access import resource_answer
from ai_assistant.apps.chat.skills import (
    default_catalog,
    list_skills,
    load_catalog,
)
from ai_assistant.apps.chat.skills.routing import compile_path, page_path


def test_bundled_skills_use_standard_entrypoints() -> None:
    assert all(skill.directory.name == skill.name for skill in list_skills())
    assert all(
        (skill.directory / "SKILL.md")
        .read_text(encoding="utf-8")
        .startswith("---\n")
        for skill in list_skills()
    )


def test_page_label_is_volatile_context_not_system_instruction() -> None:
    messages = assemble(
        payload=AdvanceInput(
            surface_kind="twin-editor",
            surface_label="一号厂房临时标题",
            user_text="检查当前配置",
            surface_context={"page": {"path": "/dashboards/d/edit/twin/n"}},
        ),
        rows=[],
        plan=None,
    )
    assert "一号厂房临时标题" not in str(messages[0].content)
    assert "一号厂房临时标题" in str(messages[-1].content)


def _external(
    root: Path,
    frontmatter: str = "name: pump-guide\ndescription: 帮助理解水泵操作规程",
) -> Path:
    directory = root / "pump-guide"
    directory.mkdir(parents=True)
    (directory / "SKILL.md").write_text(
        f"---\n{frontmatter}\n---\n\n先核对型号，再查操作规程。",
        encoding="utf-8",
    )
    (directory / "references").mkdir()
    (directory / "references" / "pump.md").write_text(
        "型号\n参数\n规程\n", encoding="utf-8"
    )
    return directory


def test_copying_a_standard_skill_only_requires_url_mapping(
    tmp_path: Path,
) -> None:
    root = tmp_path / "skills"
    _external(
        root,
        (
            "name: pump-guide\ndescription: |\n  用于水泵操作说明\nlicense: "
            "MIT\nallowed-tools: Read Bash\nmetadata:\n  author: example\ndis"
            "able-model-invocation: false"
        ),
    )
    routes = tmp_path / "routes.json"
    routes.write_text(
        json.dumps(
            {
                "routes": [
                    {
                        "paths": ["/pumps/:id", "/maintenance/**"],
                        "skills": ["pump-guide"],
                    }
                ]
            }
        )
    )
    catalog = load_catalog(root, routes)
    for path in ("/ai/pumps/one?token=secret", "/maintenance/pumps/two"):
        selected = catalog.select("collect-source", path, frozenset())
        assert [skill.name for skill in selected] == ["pump-guide"]
        assert selected[0].client_tools == ()
    assert (
        catalog.select("collect-source", "/pumps/one/other", frozenset()) == ()
    )


def test_route_selection_uses_the_same_permission_scope_as_the_roster() -> None:
    skills = default_catalog().select(
        "twin-editor",
        "/dashboards/d/edit/twin/n",
        frozenset({"dashboard:edit"}),
    )
    assert {skill.name for skill in skills} == {
        "dashboard-review",
        "twin-configure",
    }
    messages = assemble(
        payload=AdvanceInput(surface_kind="twin-editor", user_text="检查"),
        rows=[],
        plan=None,
        skills=skills,
    )
    assert "`dashboard-binding`" not in str(messages[0].content)
    assert "`twin-configure`" in str(messages[0].content)


@pytest.mark.parametrize(
    "path",
    [
        "https://example.test/pumps",
        "//example.test/pumps",
        "/../pumps",
        "/pumps\\secret",
        "/pumps\x00",
    ],
)
def test_invalid_page_paths_cannot_select_skills(path: str) -> None:
    assert page_path(path) is None
    assert default_catalog().select("twin-editor", path) == ()


@pytest.mark.parametrize(
    "pattern",
    ["/pumps/**/bad", "/pumps/x*", "/pumps/:bad-name", "/pumps?token=a"],
)
def test_ambiguous_route_patterns_fail_configuration(pattern: str) -> None:
    with pytest.raises(ValueError, match="路径"):
        compile_path(pattern)


def test_page_snapshot_drops_query_fragment_and_extra_page_fields() -> None:
    result = snapshot_of(
        {"page": {"path": "/ai/pumps/1?token=secret#private", "url": "secret"}},
        "水泵",
    )
    assert result == {"page": {"path": "/pumps/1", "label": "水泵"}}


@pytest.mark.parametrize(
    "meta",
    [
        "name: pump-guide",
        "name: other\ndescription: 示例",
        "name: pump-guide\ndescription: ''",
        "name: [broken",
    ],
)
def test_bad_skill_metadata_fails_at_catalog_load(
    tmp_path: Path, meta: str
) -> None:
    _external(tmp_path, meta)
    with pytest.raises(ValueError, match=r"元数据|技能名|描述|正文"):
        load_catalog(tmp_path)


def test_unknown_mapped_skill_fails_at_catalog_load(tmp_path: Path) -> None:
    routes = tmp_path / "routes.json"
    routes.write_text('{"routes":[{"paths":["/pumps"],"skills":["missing"]}]}')
    with pytest.raises(ValueError, match="不存在"):
        load_catalog(routes_file=routes)


async def test_resource_reads_have_a_continuation_and_stay_inside_the_skill(
    tmp_path: Path,
) -> None:
    _external(tmp_path)
    catalog = load_catalog(tmp_path)
    first = await resource_answer(
        catalog.skills,
        {"name": "pump-guide", "path": "references/pump.md", "limit": 2},
    )
    assert (first["content"], first["has_more"], first["next_line"]) == (
        "型号\n参数",
        True,
        3,
    )
    second = await resource_answer(
        catalog.skills,
        {"name": "pump-guide", "path": "references/pump.md", "start_line": 3},
    )
    assert (second["content"], second["has_more"], second["next_line"]) == (
        "规程",
        False,
        None,
    )
    with pytest.raises(ValueError, match="资源不存在"):
        await resource_answer(
            catalog.skills, {"name": "pump-guide", "path": "../../secret"}
        )


async def test_a_resource_changed_to_an_external_symlink_is_refused(
    tmp_path: Path,
) -> None:
    directory = _external(tmp_path / "skills")
    catalog = load_catalog(tmp_path / "skills")
    resource = directory / "references" / "pump.md"
    resource.unlink()
    outside = tmp_path / "private.txt"
    outside.write_text("private")
    resource.symlink_to(outside)
    with pytest.raises(ValueError, match="当前技能目录"):
        await resource_answer(
            catalog.skills, {"name": "pump-guide", "path": "references/pump.md"}
        )


def test_private_files_and_caches_are_not_skill_resources(
    tmp_path: Path,
) -> None:
    directory = _external(tmp_path)
    (directory / ".env").write_text("FAKE=fixture")
    (directory / "__pycache__").mkdir()
    (directory / "__pycache__" / "fixture.pyc").write_text("fixture")
    skill = load_catalog(tmp_path).find("pump-guide")
    assert skill is not None
    assert skill.resources == ("references/pump.md",)


@pytest.mark.parametrize(
    "content",
    [
        "缺少元数据",
        "---\nname: pump-guide\ndescription: 示例\n---\n",
        "x" * 97_000,
    ],
)
def test_missing_or_oversized_entrypoints_fail_startup(
    tmp_path: Path, content: str
) -> None:
    directory = _external(tmp_path)
    (directory / "SKILL.md").write_text(content)
    with pytest.raises(ValueError, match=r"frontmatter|正文|超过"):
        load_catalog(tmp_path)


@pytest.mark.parametrize(
    "arguments",
    [
        {"start_line": 0},
        {"start_line": 10},
        {"limit": True},
        {"limit": 201},
        {"path": 3},
    ],
)
async def test_resource_boundary_errors_offer_a_correction(
    tmp_path: Path, arguments: dict[str, object]
) -> None:
    _external(tmp_path)
    catalog = load_catalog(tmp_path)
    with pytest.raises(ValueError, match=r"必须|超出|path"):
        await resource_answer(
            catalog.skills,
            {"name": "pump-guide", "path": "references/pump.md", **arguments},
        )


async def test_large_resource_chunks_preserve_complete_lines_and_resume(
    tmp_path: Path,
) -> None:
    directory = _external(tmp_path)
    (directory / "references" / "pump.md").write_text(
        "一" * 7000 + "\n" + "二" * 7000
    )
    catalog = load_catalog(tmp_path)
    result = await resource_answer(
        catalog.skills, {"name": "pump-guide", "path": "references/pump.md"}
    )
    assert result["content"] == "一" * 7000
    assert result["next_line"] == 2


def test_missing_catalog_root_cannot_silently_drop_requested_skills(
    tmp_path: Path,
) -> None:
    with pytest.raises(ValueError, match="目录不存在"):
        load_catalog(tmp_path / "missing")


def test_skill_entrypoint_case_is_portable_to_linux(tmp_path: Path) -> None:
    directory = _external(tmp_path)
    (directory / "SKILL.md").rename(directory / "skill.md")
    with pytest.raises(ValueError, match=r"SKILL\.md"):
        load_catalog(tmp_path)
