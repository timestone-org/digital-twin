"""检索的读写编排：挑策略、跑、摊成出参。"""

import uuid
from dataclasses import asdict

from sqlalchemy.ext.asyncio import AsyncSession

from knowledge_server.apps.knowledge.errors import RetrievalUnavailable
from knowledge_server.apps.knowledge.schemas import (
    HitOut,
    LocatorOut,
    SearchIn,
    SearchOut,
)
from knowledge_server.apps.knowledge.services import library_service
from knowledge_server.apps.knowledge.services.retrieval import (
    Hit,
    RetrievalRequest,
    RetrievalResult,
    RetrievalStrategy,
    strategy_for,
)
from knowledge_server.apps.knowledge.services.retrieval import (
    RetrievalUnavailable as StrategyUnavailable,
)


def _locator_out(hit: Hit) -> LocatorOut:
    raw = asdict(hit.locator)
    return LocatorOut(
        page=raw["page"],
        sheet=raw["sheet"],
        row=raw["row"],
        path=list(raw["path"]),
        label=hit.locator.label(),
    )


def hit_out(hit: Hit) -> HitOut:
    """一条召回摊成出参。

    Args: hit。
    """
    return HitOut(
        chunk_id=hit.chunk_id,
        document_id=hit.document_id,
        document_title=hit.document_title,
        text=hit.text,
        heading_path=hit.heading_path,
        locator=_locator_out(hit),
        score=hit.score,
        why=hit.why,
    )


def search_out(made: RetrievalResult) -> SearchOut:
    """一次检索的结果摊成出参。

    Args: made。
    """
    return SearchOut(
        hits=[hit_out(one) for one in made.hits],
        strategy=made.strategy,
        rounds=made.rounds,
        is_complete=made.is_complete,
        note=made.note,
    )


async def search(
    session: AsyncSession,
    strategies: tuple[RetrievalStrategy, ...],
    base_id: uuid.UUID,
    body: SearchIn,
) -> SearchOut:
    """按库上配的（或这次点名的）策略跑一次检索。

    ⚠ 检索不了时**抛**而不是回空表：空表与「确实没有相关内容」长得一模一样，
    而调用方会把它读成「查过了，没有」然后接着往下走。

    Args: session, strategies, base_id, body。
    """
    base = await library_service.read_base(session, base_id)
    chosen = strategy_for(body.strategy or base.retrieval_strategy, strategies)
    try:
        made = await chosen.retrieve(
            session,
            RetrievalRequest(
                base_id=base_id, query=body.query, limit=body.limit
            ),
        )
    except StrategyUnavailable as error:
        reason = error.reason or "这个库还检索不了"
        raise RetrievalUnavailable(reason) from error
    return search_out(made)
