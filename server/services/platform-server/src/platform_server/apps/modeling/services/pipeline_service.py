"""流水线的增删改查与图校验。事务边界在这一层：crud 只 flush。"""

import uuid
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from lib.web import Page, PageParams
from platform_server.apps.modeling.crud import (
    model_version_crud,
    pipeline_crud,
)
from platform_server.apps.modeling.errors import (
    PipelineCodeTaken,
    PipelineHasVersions,
    PipelineNotFound,
)
from platform_server.apps.modeling.models import ModelingPipeline
from platform_server.apps.modeling.schemas import (
    GraphCheckOut,
    GraphIssueOut,
    PipelineCreateIn,
    PipelineGraph,
    PipelineOut,
    PipelineSummaryOut,
    PipelineUpdateIn,
)
from platform_server.apps.modeling.services import presenters
from platform_server.apps.modeling.services.graph_check import check_graph
from platform_server.apps.modeling.services.graph_walk import (
    known_columns_by_node,
    source_table_codes,
)


@dataclass(frozen=True)
class Actor:
    """写这一笔的人。落进 `created_by` 两列，供审计与列表页显示。"""

    user_id: str
    name: str


async def list_pipelines(
    session: AsyncSession, *, keyword: str | None, page: PageParams
) -> Page[PipelineSummaryOut]:
    """流水线列表。**页码分页**：这是有限的管理集合，不是追加型时序流。

    Args: session, keyword, page。
    """
    rows, total = await pipeline_crud.page(
        session, keyword=keyword, offset=page.offset, limit=page.size
    )
    return Page[PipelineSummaryOut](
        items=[presenters.to_pipeline_summary(row) for row in rows],
        page=page.page,
        size=page.size,
        total=total,
    )


async def get_pipeline(
    session: AsyncSession, pipeline_id: uuid.UUID
) -> PipelineOut:
    """流水线详情。

    Args: session, pipeline_id。
    """
    return presenters.to_pipeline_out(
        await require_pipeline(session, pipeline_id)
    )


async def create_pipeline(
    session: AsyncSession, *, payload: PipelineCreateIn, actor: Actor
) -> PipelineOut:
    """建一条流水线。编码重复即 409。

    Args: session, payload, actor。
    """
    if await pipeline_crud.get_by_code(session, payload.code) is not None:
        raise PipelineCodeTaken("这个流水线编码已经被占用了")
    row = pipeline_crud.add(
        session,
        ModelingPipeline(
            code=payload.code,
            name=payload.name,
            description=payload.description,
            graph_json=payload.graph.model_dump(),
            source_table_codes=list(source_table_codes(payload.graph)),
            created_by=actor.user_id,
            created_by_name=actor.name,
        ),
    )
    await session.flush()
    return presenters.to_pipeline_out(row)


async def update_pipeline(
    session: AsyncSession,
    *,
    pipeline_id: uuid.UUID,
    payload: PipelineUpdateIn,
) -> PipelineOut:
    """整体保存。图一并重算「用到了哪些台账」这条反查索引。

    ⚠ `source_table_codes` **只由这条路径写**：另开一处写它，两份就会漂。
    Args: session, pipeline_id, payload。
    """
    row = await require_pipeline(session, pipeline_id)
    if payload.name is not None:
        row.name = payload.name
    if payload.description is not None:
        row.description = payload.description
    if payload.graph is not None:
        row.graph_json = payload.graph.model_dump()
        row.source_table_codes = list(source_table_codes(payload.graph))
    await session.flush()
    return presenters.to_pipeline_out(row)


async def delete_pipeline(
    session: AsyncSession, pipeline_id: uuid.UUID
) -> None:
    """删流水线。还有模型版本时 409——版本是交付物，不该被顺手删掉。

    Args: session, pipeline_id。
    """
    row = await require_pipeline(session, pipeline_id)
    if await model_version_crud.count_of_pipeline(session, row.id):
        raise PipelineHasVersions("这条流水线下还有模型版本，请先把它们退役")
    await pipeline_crud.delete(session, row)


async def check_pipeline(
    session: AsyncSession,
    pipeline_id: uuid.UUID,
    *,
    graph: PipelineGraph | None = None,
) -> GraphCheckOut:
    """校验一张图。与保存、导入、运行前用的是同一份实现。

    ⚠ 给了 `graph` 就校验它、不给才回退到库里那份：画布上那份还没保存，只校验
    库里那份的话，用户改完一条再按校验，看到的仍是上一次保存时的问题。
    Args: session, pipeline_id, graph。
    """
    row = await require_pipeline(session, pipeline_id)
    if graph is not None:
        return check_result(graph)
    return check_result(presenters.graph_of(row.graph_json))


def check_result(graph: PipelineGraph) -> GraphCheckOut:
    """把校验问题折成对外形态，顺带回逐节点看得见哪些列。

    ⚠ 列候选**由后端算**：前端另写一份收窄口径的话，两份各自自洽而真跑起来
    对不上（docs/MODELING_PLATFORM_DESIGN.md D2）。
    Args: graph。
    """
    issues = check_graph(graph)
    return GraphCheckOut(
        is_valid=not issues,
        issues=[
            GraphIssueOut(
                message=item.message,
                node_id=item.node_id,
                edge_id=item.edge_id,
            )
            for item in issues
        ],
        known_columns=known_columns_by_node(graph, graph.node_by_id()),
    )


async def require_pipeline(
    session: AsyncSession, pipeline_id: uuid.UUID
) -> ModelingPipeline:
    """取流水线，取不到即 404。

    Args: session, pipeline_id。
    """
    row = await pipeline_crud.get(session, pipeline_id)
    if row is None:
        raise PipelineNotFound("流水线不存在")
    return row
