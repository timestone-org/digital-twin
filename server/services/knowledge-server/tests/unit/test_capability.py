"""能力面：报的是「此刻真能用什么」，而有毛病时必须说出是什么毛病。"""

from dataclasses import dataclass

import pytest
from pydantic import SecretStr

from knowledge_server.apps.knowledge.services.capability import (
    EXTERNAL_PARSER_ABSENT,
    NO_RERANK_REASON,
    RERANK_FAILING_REASON,
    ModelLanes,
    capability_of,
    index_capability_of,
    parsing_capability_of,
    rerank_capability_of,
)
from knowledge_server.apps.knowledge.services.indexing import PGVECTOR, TRGM
from knowledge_server.apps.knowledge.services.parsing import (
    ParsedDocument,
    RawItem,
)
from knowledge_server.apps.knowledge.services.reranking import NullReranker
from knowledge_server.settings import Settings

PLACEHOLDER = "knowledge-test"
# 库上那一列的维数，取值本身不参与断言之外的任何判断
COLUMN_DIMENSIONS = 1536


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


def test_both_lanes_are_reported_by_name() -> None:
    """⚠ 两路都没有回退档了（ADR-0045），但界面仍要说得出检索是怎么做的。"""
    out = index_capability_of(COLUMN_DIMENSIONS)
    assert (out.vector, out.keyword) == (PGVECTOR, TRGM)
    assert out.reason == ""


def test_a_dimension_gap_is_reported_before_any_upload() -> None:
    """⚠ 维数对不上时每一份文档都会摄取失败，而那条错看着像文档的问题。
    这一格要在传文档之前就说出两个数字，以及该改哪个环境变量。"""
    out = index_capability_of(COLUMN_DIMENSIONS, model_dimensions=1024)
    assert "1536" in out.reason
    assert "1024" in out.reason
    assert "KNOWLEDGE_EMBEDDING_DIMENSIONS" in out.reason


def test_no_embedding_lane_reports_no_dimension_gap() -> None:
    """⚠ 没接嵌入档时维数是 0，那不是「对不上」——那句话会把人引到
    维数上去，而真正缺的是模型分配。"""
    assert (
        index_capability_of(COLUMN_DIMENSIONS, model_dimensions=0).reason == ""
    )


def test_the_local_parser_lane_is_reported_by_name() -> None:
    made = parsing_capability_of(())
    assert "docx" in made.local_backends
    assert "text" in made.local_backends


def test_an_absent_external_parser_lane_says_why() -> None:
    """⚠ 空表配空原因会被界面读成「一切正常」，而这里要说的是「这套部署根本
    没接那一路」——悄悄缺席的表现是「传上去的 PDF 一直失败，没人知道为什么」。"""
    made = parsing_capability_of(())
    assert made.external_backends == []
    assert made.reason == EXTERNAL_PARSER_ABSENT


def test_a_connected_external_parser_lane_reports_no_reason() -> None:
    made = parsing_capability_of((_FakeRemote(),), ())
    assert made.external_backends == ["fake-remote"]
    assert made.reason == ""


def test_an_absent_rerank_lane_says_why(settings: Settings) -> None:
    """⚠ 没接重排时检索走的是融合名次那一档：不说的话，质量忽然变了
    却没有任何一处报错。"""
    out = capability_of(settings)
    assert out.rerank.is_enabled is False
    assert out.rerank.model == ""
    assert "知识库重排" in out.rerank.reason


def test_a_connected_rerank_lane_names_its_model(settings: Settings) -> None:
    out = capability_of(
        settings,
        lanes=ModelLanes(
            is_embedding_enabled=True,
            is_model_enabled=True,
            is_rerank_enabled=True,
            rerank_model="gte-rerank-v2",
        ),
    )
    assert out.rerank.is_enabled is True
    assert out.rerank.model == "gte-rerank-v2"
    assert out.rerank.reason == ""


def test_a_rerank_lane_that_is_connected_and_healthy_says_nothing() -> None:
    made = rerank_capability_of(
        ModelLanes(
            is_embedding_enabled=True,
            is_model_enabled=True,
            is_rerank_enabled=True,
            rerank_model="bge-reranker",
        )
    )
    assert made.is_enabled is True
    assert made.reason == ""


def test_a_rerank_lane_that_is_never_connected_says_so() -> None:
    """⚠ 「没接」是这套部署的常态，不是毛病：那句话要与「接了但排不成」
    分开，否则运维会去查一个根本没配过的端点。"""
    made = rerank_capability_of(
        ModelLanes(is_embedding_enabled=True, is_model_enabled=True)
    )
    assert made.is_enabled is False
    assert made.reason == NO_RERANK_REASON


def test_a_connected_lane_that_keeps_failing_stops_claiming_it_is_fine() -> (
    None
):
    """⚠ 这一条是实测出来的：端点接着、`/v1/models` 秒回、`/v1/rerank` 挂住
    不回，于是每次检索先等满超时——而能力面报的是「接了、一切正常」。
    「接了」与「接了而且排得成」是两件事。"""
    made = rerank_capability_of(
        ModelLanes(
            is_embedding_enabled=True,
            is_model_enabled=True,
            is_rerank_enabled=True,
            is_rerank_failing=True,
            rerank_model="bge-reranker",
        )
    )
    assert made.is_enabled is True
    assert made.reason == RERANK_FAILING_REASON
    # ⚠ 那句话要说得出下一步：只说「不可用」会让人去查网络
    assert "端点" in made.reason


def test_the_null_lane_is_not_reported_as_failing() -> None:
    """⚠ 缺席不是失败。`NullReranker` 的 `is_failing` 必须是假，否则每一套
    没配重排的部署都会在界面上挂一条红字。"""
    assert NullReranker().is_failing is False
