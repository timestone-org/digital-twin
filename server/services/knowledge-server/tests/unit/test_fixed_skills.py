"""知识库单入口使用固定技能目录，无需页面参数或 URL 映射。"""

from pathlib import Path

from knowledge_server.apps.chat.schemas.advance import ChatAdvanceIn
from knowledge_server.apps.chat.services import advance_service as service
from knowledge_server.apps.chat.services.scope import ALL_BASES
from knowledge_server.apps.chat.skills import default_catalog, load_catalog
from knowledge_server.container import _build_skills
from knowledge_server.settings import ROLE_WORKER, Settings


def test_chat_contract_has_no_page_context() -> None:
    assert set(ChatAdvanceIn.model_fields) == {
        "user_text",
        "tool_results",
        "client_tools",
    }
    messages = service.assemble(
        payload=service.AdvanceInput(user_text="查手册"),
        rows=[],
        summary=None,
        scope=ALL_BASES,
    )
    assert "knowledge-retrieval" in str(messages[0].content)
    assert "knowledge-live-data" in str(messages[0].content)
    assert "当前页面" not in str(messages)


def test_copied_standard_skill_needs_only_a_directory(tmp_path: Path) -> None:
    directory = tmp_path / "copied-guide"
    directory.mkdir()
    (directory / "SKILL.md").write_text(
        "---\nname: copied-guide\ndescription: Read equipment manuals.\n---\n"
        "Use real search results and preserve citations.\n",
        encoding="utf-8",
    )
    catalog = load_catalog(tmp_path)
    assert catalog.routes == ()
    assert {
        skill.name
        for skill in catalog.select(codes=frozenset({"knowledge:use"}))
    } == {"copied-guide", "knowledge-retrieval", "knowledge-live-data"}


def test_catalog_filters_skills_by_permissions() -> None:
    catalog = default_catalog()
    assert catalog.select(codes=frozenset()) == ()
    assert len(catalog.select(codes=frozenset({"knowledge:use"}))) == 2


def test_worker_does_not_load_chat_skill_files(tmp_path: Path) -> None:
    settings = Settings.model_construct(
        app_role=ROLE_WORKER, skills_directory=tmp_path / "absent"
    )
    assert _build_skills(settings) is None
