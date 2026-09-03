"""能力面：报的是「此刻真能用哪一档」，而且走回退档时必须说出原因。"""

from dataclasses import dataclass

import pytest
from pydantic import SecretStr

from knowledge_server.apps.knowledge.services.capability import (
    EXTERNAL_PARSER_ABSENT,
    KEYWORD_FALLBACK,
    KEYWORD_FAST,
    VECTOR_FALLBACK,
    VECTOR_FAST,
    capability_of,
    index_capability_of,
    keyword_choice,
    parsing_capability_of,
    vector_choice,
)
from knowledge_server.apps.knowledge.services.parsing import (
    ParsedDocument,
    RawItem,
)
from knowledge_server.probe import IndexProbe
from knowledge_server.settings import Settings

PLACEHOLDER = "knowledge-test"


@dataclass(frozen=True)
class _FakeRemote:
    """一路假的外部解析后端；能力面只读它的名字。"""

    name: str = "fake-remote"
    suffixes: tuple[str, ...] = (".pdf",)
    media_types: tuple[str, ...] = ("application/pdf",)

    async def parse_remote(
        self, raw: RawItem, timeout_s: float
    ) -> ParsedDocument:
        """这一组用不到真解析。

        Args: raw, timeout_s。
        """
        raise NotImplementedError


@pytest.fixture
def settings() -> Settings:
    return Settings(  # pyright: ignore[reportArgumentType]
        postgres_host=PLACEHOLDER,
        postgres_user=PLACEHOLDER,
        postgres_password=SecretStr(PLACEHOLDER),
        postgres_db=PLACEHOLDER,
        redis_host=PLACEHOLDER,
        objectstore_endpoint="http://knowledge-test:9000",
        objectstore_bucket=PLACEHOLDER,
        objectstore_access_key=SecretStr(PLACEHOLDER),
        objectstore_secret_key=SecretStr("s" * 16),
        edge_signing_secret=SecretStr("s" * 32),
        edge_service_key=SecretStr("k" * 32),
    )


def _ready() -> IndexProbe:
    return IndexProbe(
        has_pgvector=True,
        has_vector_table=True,
        has_trgm=True,
        is_probed=True,
    )


def test_fast_lane_when_everything_is_installed(settings: Settings) -> None:
    choice, reason = vector_choice(settings, _ready())
    assert choice == VECTOR_FAST
    assert reason == ""


def test_unprobed_falls_back_and_says_so(settings: Settings) -> None:
    choice, reason = vector_choice(settings, IndexProbe())
    assert choice == VECTOR_FALLBACK
    assert "探测不到" in reason


def test_missing_extension_falls_back_and_says_so(
    settings: Settings,
) -> None:
    choice, reason = vector_choice(
        settings, IndexProbe(is_probed=True, has_pgvector=False)
    )
    assert choice == VECTOR_FALLBACK
    assert "pgvector" in reason


def test_extension_without_table_points_at_the_command(
    settings: Settings,
) -> None:
    """⚠ 装了扩展但没建加速表时，要说清下一步该跑什么——只说「未启用」
    的话，人会去查扩展装没装，而那一格是好的。"""
    choice, reason = vector_choice(
        settings,
        IndexProbe(is_probed=True, has_pgvector=True, has_vector_table=False),
    )
    assert choice == VECTOR_FALLBACK
    assert "--enable" in reason


def test_forced_fallback_is_honoured(settings: Settings) -> None:
    forced = settings.model_copy(update={"vector_index": VECTOR_FALLBACK})
    choice, reason = vector_choice(forced, _ready())
    assert choice == VECTOR_FALLBACK
    assert "配置" in reason


def test_forced_fast_lane_still_falls_back_when_absent(
    settings: Settings,
) -> None:
    """⚠ 配置强制加速档而库里没有时仍然回退，不抛：这一档只是加速，
    正确性不依赖它，而抛的话服务起不来。"""
    forced = settings.model_copy(update={"vector_index": VECTOR_FAST})
    choice, _ = vector_choice(forced, IndexProbe(is_probed=True))
    assert choice == VECTOR_FALLBACK


def test_keyword_lane_mirrors_the_vector_lane(settings: Settings) -> None:
    assert keyword_choice(settings, _ready())[0] == KEYWORD_FAST
    fallback, reason = keyword_choice(settings, IndexProbe(is_probed=True))
    assert fallback == KEYWORD_FALLBACK
    assert "pg_trgm" in reason


def test_forced_keyword_fallback_is_honoured(settings: Settings) -> None:
    forced = settings.model_copy(update={"keyword_index": KEYWORD_FALLBACK})
    choice, reason = keyword_choice(forced, _ready())
    assert choice == KEYWORD_FALLBACK
    assert "ILIKE" in reason


def test_two_lanes_report_their_own_reasons(settings: Settings) -> None:
    """⚠ 一路走加速档、另一路走回退档是常态，合成一句之后
    没人知道说的是哪一路。"""
    half = IndexProbe(
        has_pgvector=True, has_vector_table=True, has_trgm=False, is_probed=True
    )
    out = index_capability_of(settings, half)
    assert out.vector == VECTOR_FAST
    assert out.keyword == KEYWORD_FALLBACK
    assert "pg_trgm" in out.reason


def test_capability_reports_both_model_paths(settings: Settings) -> None:
    out = capability_of(settings, _ready())
    assert out.is_embedding_enabled is False
    assert out.is_model_enabled is False
    assert out.index.vector == VECTOR_FAST


def test_the_local_parser_lane_is_reported_by_name() -> None:
    made = parsing_capability_of()
    assert "docx" in made.local_backends
    assert "text" in made.local_backends


def test_an_absent_external_parser_lane_says_why() -> None:
    """⚠ 空表配空原因会被界面读成「一切正常」，而这里要说的是「这套部署根本
    没接那一路」——悄悄缺席的表现是「传上去的 PDF 一直失败，没人知道为什么」。"""
    made = parsing_capability_of()
    assert made.external_backends == []
    assert made.reason == EXTERNAL_PARSER_ABSENT


def test_a_connected_external_parser_lane_reports_no_reason() -> None:
    made = parsing_capability_of((), (_FakeRemote(),))
    assert made.external_backends == ["fake-remote"]
    assert made.reason == ""
