"""流水线迁移的兼容性检查与独立导入。"""

import uuid

from pydantic import ValidationError
from pydantic_core import ErrorDetails
from sqlalchemy.ext.asyncio import AsyncSession

from platform_server.apps.dataset.services import table_service
from platform_server.apps.modeling.errors import GraphInvalid
from platform_server.apps.modeling.operators import registry
from platform_server.apps.modeling.schemas.graph import GRAPH_FORMAT_VERSION
from platform_server.apps.modeling.schemas.pipeline import (
    PipelineCreateIn,
    PipelineOut,
)
from platform_server.apps.modeling.schemas.transfer import (
    PipelineImportIn,
    PipelineImportInspection,
    PipelineTransferDocument,
    TransferIssue,
    TransferOperator,
    TransferPipeline,
)
from platform_server.apps.modeling.services import pipeline_service
from platform_server.apps.modeling.services.graph_check import (
    check_graph,
    check_graph_structure,
)
from platform_server.apps.modeling.services.graph_walk import source_table_codes
from platform_server.apps.modeling.services.pipeline_service import Actor


def inspect_document(
    document: PipelineTransferDocument,
) -> PipelineImportInspection:
    """检查版本、清单、拓扑与配置；Args: document。"""
    graph = document.pipeline.graph
    issues = _manifest_issues(document)
    structure = check_graph_structure(graph)
    if not graph.nodes and not graph.edges:
        structure = []
        issues.append(
            TransferIssue(
                level="warning",
                message="流水线是空白草稿，导入后请添加并配置算子",
            )
        )
    issues += [
        TransferIssue(level="error", **issue.__dict__) for issue in structure
    ]
    if graph.format_version != GRAPH_FORMAT_VERSION:
        issues.append(
            TransferIssue(level="error", message="不支持的流水线图格式版本")
        )
    if len({edge.id for edge in graph.edges}) != len(graph.edges):
        issues.append(TransferIssue(level="error", message="连线 id 重复"))
    if not any(issue.level == "error" for issue in issues):
        issues += _configuration_issues(document)
    return PipelineImportInspection(
        document=document,
        can_import=not any(issue.level == "error" for issue in issues),
        issues=issues,
        source_table_codes=list(source_table_codes(graph)),
        node_count=len(graph.nodes),
        edge_count=len(graph.edges),
    )


def _manifest_issues(document: PipelineTransferDocument) -> list[TransferIssue]:
    used = {node.operator for node in document.pipeline.graph.nodes}
    declared = [item.operator for item in document.operators]
    issues: list[TransferIssue] = []
    if len(declared) != len(set(declared)):
        issues.append(
            TransferIssue(level="error", message="算子版本清单中存在重复项")
        )
    if set(declared) != used:
        issues.append(
            TransferIssue(
                level="error",
                message="算子版本清单必须完整且只包含图中使用的算子",
            )
        )
    for item in document.operators:
        if not registry.has(item.operator):
            issues.append(
                TransferIssue(
                    level="error",
                    message=f"当前系统没有算子「{item.operator}」",
                )
            )
        elif item.spec_version != registry.get(item.operator).SPEC_VERSION:
            issues.append(
                TransferIssue(
                    level="warning",
                    message=f"算子「{item.operator}」契约版本不同，导入后请核对配置与结果",
                )
            )
    return issues


def _configuration_issues(
    document: PipelineTransferDocument,
) -> list[TransferIssue]:
    graph = document.pipeline.graph
    issues = [
        TransferIssue(level="warning", **issue.__dict__)
        for issue in check_graph(graph)
    ]
    for node in graph.nodes:
        try:
            registry.get(node.operator).CONFIG_MODEL.model_validate(node.config)
        except ValidationError as error:
            if _invalid_supplied_values(error.errors()):
                issues.append(
                    TransferIssue(
                        level="error",
                        message="配置中含有未知参数或参数值的类型、结构不正确，请先修正",
                        node_id=node.id,
                    )
                )
    return issues


def _invalid_supplied_values(errors: list[ErrorDetails]) -> bool:
    """已提供值的无效形状必须拒绝，未填写值保留草稿；Args: errors。"""
    for item in errors:
        if item["type"] == "extra_forbidden":
            return True
        value = item.get("input")
        if item["type"] == "missing" or value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        if item["type"] == "too_short" and value == []:
            continue
        return True
    return False


async def inspect_import(
    session: AsyncSession, document: PipelineTransferDocument
) -> PipelineImportInspection:
    """预检并列出需重新接线的台账；Args: session, document。"""
    result = inspect_document(document)
    for code in result.source_table_codes:
        # resolve_table_code 的异常仅表示当前部署没有该业务引用。
        try:
            await table_service.resolve_table_code(session, code)
        except table_service.DatasetTableNotFound:
            result.issues.append(
                TransferIssue(
                    level="warning",
                    message=f"当前系统没有台账「{code}」，导入后请重新选择数据源",
                )
            )
    if any(
        node.operator == "bdm_source" for node in document.pipeline.graph.nodes
    ):
        result.issues.append(
            TransferIssue(
                level="warning",
                message="能管连接与凭据使用当前部署配置，请核对来源标识与可用性",
            )
        )
    return result


async def export_pipeline(
    session: AsyncSession, pipeline_id: uuid.UUID
) -> PipelineTransferDocument:
    """导出已保存的流水线定义；Args: session, pipeline_id。"""
    pipeline = await pipeline_service.get_pipeline(session, pipeline_id)
    codes = sorted({node.operator for node in pipeline.graph.nodes})
    if any(not registry.has(code) for code in codes):
        raise GraphInvalid(
            "流水线含有当前系统不认识的算子，无法导出完整版本清单"
        )
    for node in pipeline.graph.nodes:
        try:
            registry.get(node.operator).CONFIG_MODEL.model_validate(node.config)
        except ValidationError as error:
            if _invalid_supplied_values(error.errors()):
                raise GraphInvalid(
                    f"节点「{node.alias or node.id}」"
                    "配置含有未知参数或无效类型，无法可靠导出"
                ) from error
    return PipelineTransferDocument(
        format_version="1.0",
        pipeline=TransferPipeline(
            code=pipeline.code,
            name=pipeline.name,
            description=pipeline.description,
            graph=pipeline.graph,
        ),
        operators=[
            TransferOperator(
                operator=code, spec_version=registry.get(code).SPEC_VERSION
            )
            for code in codes
        ],
    )


async def import_pipeline(
    session: AsyncSession, payload: PipelineImportIn, actor: Actor
) -> PipelineOut:
    """导入成独立流水线，永不覆盖原对象；Args: session, payload, actor。"""
    inspection = inspect_document(payload.document)
    if not inspection.can_import:
        raise GraphInvalid(
            "；".join(
                issue.message
                for issue in inspection.issues
                if issue.level == "error"
            )
        )
    return await pipeline_service.create_pipeline(
        session,
        payload=PipelineCreateIn(
            code=payload.code,
            name=payload.name,
            description=payload.description,
            graph=payload.document.pipeline.graph,
        ),
        actor=actor,
    )
