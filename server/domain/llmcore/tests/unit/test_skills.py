"""标准技能包可被独立宿主装配，范围、资源和失败反馈保持有界。"""

import json
from pathlib import Path
from typing import Any

import pytest
from langchain_core.messages import ToolMessage

from llmcore.skills import load_catalog
from llmcore.skills.access import resource_answer
from llmcore.skills.context import restored_from_messages
from llmcore.skills.tools import METADATA_SPECS
from llmcore.testing import asks
from llmcore.tools.execution import ToolExecutionError, ToolExecutor


def _package(root: Path) -> Path:
    directory = root / "library" / "test-skill"
    (directory / "references").mkdir(parents=True)
    (directory / "SKILL.md").write_text(
        "---\nname: test-skill\ndescription: Read the guide for this task.\n"
        "metadata:\n  author: example\n---\n\n"
        "Read references/guide.md before changing the result.\n"
    )
    (directory / "references/guide.md").write_text("one\ntwo\nthree\n")
    (root / "integrations.json").write_text(
        json.dumps(
            [
                {
                    "name": "test-skill",
                    "title": "Test",
                    "surface_kinds": ["chat"],
                    "required_codes": ["use"],
                }
            ]
        )
    )
    (root / "routes.json").write_text(
        json.dumps(
            {
                "routes": [
                    {
                        "paths": ["/docs/:id", "/help/**"],
                        "skills": ["test-skill"],
                    }
                ]
            }
        )
    )
    return directory


async def _unused(_name: str, _arguments: dict[str, Any]) -> object:
    raise AssertionError("metadata must not execute a business tool")


def test_hosts_supply_paths_prefixes_and_permission_scope(
    tmp_path: Path,
) -> None:
    _package(tmp_path)
    catalog = load_catalog(tmp_path, path_prefix="/app")
    for path in ("/app/docs/one?token=private", "/help/one/two"):
        assert [
            one.name for one in catalog.select("chat", path, frozenset({"use"}))
        ] == ["test-skill"]
        assert catalog.select("chat", path, frozenset()) == ()
    assert catalog.select("chat", "/docs/one/extra") == ()
    assert catalog.select("chat")[0].name == "test-skill"
    assert catalog.find("missing") is None


@pytest.mark.parametrize(
    "entry",
    [
        "not frontmatter",
        "---\nname: other\ndescription: test\n---\nbody",
        "---\nname: test-skill\n---\nbody",
        "---\nname: test-skill\ndescription: test\n---\n",
    ],
)
def test_invalid_packages_fail_before_requests(
    tmp_path: Path, entry: str
) -> None:
    directory = _package(tmp_path)
    (directory / "SKILL.md").write_text(entry)
    with pytest.raises(ValueError, match=r"frontmatter|一致|元数据|正文"):
        load_catalog(tmp_path)


async def test_metadata_execution_reads_full_skills_and_bounded_resources(
    tmp_path: Path,
) -> None:
    directory = _package(tmp_path)
    (directory / ".env").write_text("TEST_ONLY=private")
    skills = load_catalog(tmp_path).skills
    executor = ToolExecutor(
        METADATA_SPECS, skills, _unused, max_skill_chars=1000
    )
    loaded = await executor("skills.load", {"name": "test-skill"})
    assert loaded["resources"] == ["references/guide.md"]
    resource = await executor(
        "skills.read_resource",
        {"name": "test-skill", "path": "references/guide.md", "limit": 2},
    )
    assert (resource["content"], resource["next_line"]) == ("one\ntwo", 3)
    described = await executor("tools.describe", {"name": "skills.load"})
    assert described["input_schema"]["required"] == ["name"]
    with pytest.raises(ToolExecutionError, match="不存在"):
        await executor(
            "skills.read_resource", {"name": "test-skill", "path": "../.env"}
        )


async def test_skill_activation_cannot_silently_truncate_its_instructions(
    tmp_path: Path,
) -> None:
    _package(tmp_path)
    executor = ToolExecutor(
        METADATA_SPECS,
        load_catalog(tmp_path).skills,
        _unused,
        max_skill_chars=20,
    )
    with pytest.raises(ToolExecutionError, match="上下文预算"):
        await executor("skills.load", {"name": "test-skill"})


async def test_resource_limit_keeps_complete_lines_and_reports_continuation(
    tmp_path: Path,
) -> None:
    _package(tmp_path)
    skills = load_catalog(tmp_path).skills
    result = await resource_answer(
        skills,
        {"name": "test-skill", "path": "references/guide.md"},
        max_chars=5,
    )
    assert (result["content"], result["has_more"], result["next_line"]) == (
        "one",
        True,
        2,
    )
    with pytest.raises(ValueError, match="单行"):
        await resource_answer(
            skills,
            {"name": "test-skill", "path": "references/guide.md"},
            max_chars=2,
        )


def test_restoration_uses_the_actual_visible_messages_after_character_fitting(
    tmp_path: Path,
) -> None:
    _package(tmp_path)
    skills = load_catalog(tmp_path).skills
    messages = [
        asks("skills.load", "load", name="test-skill"),
        ToolMessage(
            content='{"ok":true,"instructions":"loaded"}', tool_call_id="load"
        ),
    ]
    assert restored_from_messages(messages, messages, skills) == []
    restored = restored_from_messages(messages, [], skills)
    assert "Read references/guide.md" in str(restored[0].content)
    bounded = restored_from_messages(messages, [], skills, max_chars=1)
    assert "skills.load" in str(bounded[0].content)
    assert "Read references/guide.md" not in str(bounded[0].content)


async def test_dynamic_budget_pages_complete_json_without_losing_lines(
    tmp_path: Path,
) -> None:
    directory = _package(tmp_path)
    lines = [f"line {n}: " + "内容" * 30 for n in range(20)]
    (directory / "references/guide.md").write_text("\n".join(lines))
    executor = ToolExecutor(
        METADATA_SPECS, load_catalog(tmp_path).skills, _unused
    )
    received: list[str] = []
    start = 1
    while True:
        raw = await executor.run_with_budget(
            "skills.read_resource",
            {
                "name": "test-skill",
                "path": "references/guide.md",
                "start_line": start,
            },
            450,
        )
        assert len(raw) <= 450
        page = json.loads(raw)
        received.extend(page["content"].splitlines())
        assert page["end_line"] == len(received)
        if not page["has_more"]:
            assert page["next_line"] is None
            break
        assert page["next_line"] > start
        start = page["next_line"]
    assert received == lines
    with pytest.raises(ToolExecutionError, match="context_budget_exceeded"):
        await executor.run_with_budget(
            "skills.load", {"name": "test-skill"}, 100
        )
    with pytest.raises(ToolExecutionError, match="context_budget_exceeded"):
        await executor.run_with_budget(
            "tools.describe", {"name": "skills.load"}, 100
        )


async def test_copied_resources_cannot_escape_or_reveal_hidden_files(
    tmp_path: Path,
) -> None:
    directory = _package(tmp_path)
    executor = ToolExecutor(
        METADATA_SPECS, load_catalog(tmp_path).skills, _unused
    )
    outside = tmp_path / "outside.txt"
    outside.write_text("private")
    guide = directory / "references/guide.md"
    guide.unlink()
    guide.symlink_to(outside)
    with pytest.raises(ToolExecutionError, match="目录内"):
        await executor(
            "skills.read_resource",
            {"name": "test-skill", "path": "references/guide.md"},
        )
    with pytest.raises(ValueError, match="符号链接"):
        load_catalog(tmp_path)


@pytest.mark.parametrize(
    "path",
    ["https://example.com/x", "//example.com", "relative", "/bad/../path"],
)
def test_untrusted_page_paths_never_select_a_skill(
    tmp_path: Path, path: str
) -> None:
    _package(tmp_path)
    assert load_catalog(tmp_path).select("chat", path) == ()


async def test_invalid_metadata_calls_report_recovery(
    tmp_path: Path,
) -> None:
    directory = _package(tmp_path)
    executor = ToolExecutor(
        METADATA_SPECS, load_catalog(tmp_path).skills, _unused
    )
    for name, args, code in [
        ("not.offered", {}, "tool_unavailable"),
        ("skills.load", {}, "invalid_arguments"),
        ("skills.load", {"name": "absent"}, "invalid_arguments"),
        ("tools.describe", {"name": "absent"}, "invalid_arguments"),
        (
            "skills.read_resource",
            {
                "name": "test-skill",
                "path": "references/guide.md",
                "start_line": 99,
            },
            "invalid_arguments",
        ),
    ]:
        with pytest.raises(ToolExecutionError) as error:
            await executor(name, args)
        body = json.loads(str(error.value))
        assert body["code"] == code
        assert body["execution"] == "not_started"
        assert body["next_action"]
    (directory / "references/guide.md").write_bytes(b"\xff")
    with pytest.raises(ToolExecutionError, match="invalid_arguments"):
        await executor(
            "skills.read_resource",
            {"name": "test-skill", "path": "references/guide.md"},
        )


def test_fixed_host_catalog_does_not_require_route_configuration(
    tmp_path: Path,
) -> None:
    _package(tmp_path)
    (tmp_path / "routes.json").unlink()
    catalog = load_catalog(tmp_path, should_include_routes=False)
    assert catalog.routes == ()
    assert catalog.select(codes=frozenset()) == ()
    assert [one.name for one in catalog.select(codes=frozenset({"use"}))] == [
        "test-skill"
    ]
    assert catalog.select("different-surface", codes=frozenset({"use"})) == ()
