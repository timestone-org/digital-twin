"""从算子真源生成整图配置 Schema，并原子校验完整参数。"""

from pydantic import JsonValue

from lib.errors.base import FieldError
from platform_server.apps.modeling.errors import GraphInvalid
from platform_server.apps.modeling.operators import registry
from platform_server.apps.modeling.schemas.graph import PipelineGraph
from platform_server.apps.modeling.schemas.operator import OperatorOut
from platform_server.apps.modeling.schemas.template import (
    ModelingConfiguration,
    ModelingConfigurationOut,
    ModelingParameterNodeOut,
)
from platform_server.apps.modeling.services.graph_check import check_graph
from platform_server.apps.modeling.services.graph_walk import (
    known_columns_by_node,
)


def require_template_graph(graph: PipelineGraph) -> PipelineGraph:
    """校验可建模的单模型图并补全默认参数；Args: graph。"""
    issues = check_graph(graph)
    if issues:
        raise GraphInvalid(
            "请先修正参数或连线",
            details=tuple(
                FieldError(
                    field=(
                        f"configuration.nodes.{item.node_id}"
                        if item.node_id
                        else "graph"
                    ),
                    code="graph_invalid",
                    message=item.message,
                )
                for item in issues
            ),
        )
    models = [
        node
        for node in graph.nodes
        if any(
            port.contract == "model@v1"
            for port in registry.get(node.operator).OUTPUTS
        )
    ]
    if len(models) != 1:
        raise GraphInvalid("建模模板必须包含且只包含一个产出模型的算子")
    nodes = [
        node.model_copy(
            update={
                "config": registry.get(node.operator)
                .CONFIG_MODEL.model_validate(node.config)
                .model_dump(mode="json")
            }
        )
        for node in graph.nodes
    ]
    return graph.model_copy(update={"nodes": nodes})


def configure_graph(
    graph: PipelineGraph, configuration: ModelingConfiguration
) -> PipelineGraph:
    """替换全部节点参数，结构固定；Args: graph, configuration。"""
    expected = {node.id for node in graph.nodes}
    supplied = set(configuration.nodes)
    if expected != supplied:
        fields = [
            FieldError(
                field=f"configuration.nodes.{key}",
                code="missing_node" if key in expected else "unknown_node",
                message=(
                    "缺少节点参数" if key in expected else "模板中没有这个节点"
                ),
            )
            for key in sorted(expected ^ supplied)
        ]
        raise GraphInvalid("必须提供模板的全部节点参数", details=tuple(fields))
    nodes = [
        node.model_copy(update={"config": dict(configuration.nodes[node.id])})
        for node in graph.nodes
    ]
    return require_template_graph(graph.model_copy(update={"nodes": nodes}))


def describe_configuration(graph: PipelineGraph) -> ModelingConfigurationOut:
    """返回全部参数、每节点 Schema 与组合 Schema；Args: graph。"""
    columns = known_columns_by_node(graph, graph.node_by_id())
    nodes = [
        ModelingParameterNodeOut(
            id=node.id,
            alias=node.alias,
            operator=OperatorOut.model_validate(
                registry.get(node.operator).spec().model_dump()
            ),
            config=node.config,
            known_columns=columns.get(node.id),
        )
        for node in graph.nodes
    ]
    properties: dict[str, JsonValue] = {}
    for node in nodes:
        escaped = node.id.replace("~", "~0").replace("/", "~1")
        properties[node.id] = _relocate_refs(
            node.operator.config_schema,
            f"#/properties/nodes/properties/{escaped}",
        )
    node_schema: dict[str, JsonValue] = {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }
    schema: dict[str, JsonValue] = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {"nodes": node_schema},
        "required": ["nodes"],
        "additionalProperties": False,
    }
    return ModelingConfigurationOut(
        configuration=ModelingConfiguration(
            nodes={node.id: node.config for node in nodes}
        ),
        json_schema=schema,
        nodes=nodes,
    )


def _relocate_refs(value: JsonValue, prefix: str) -> JsonValue:
    if isinstance(value, list):
        return [_relocate_refs(item, prefix) for item in value]
    if isinstance(value, dict):
        return {
            key: (
                prefix + item[1:]
                if key == "$ref"
                and isinstance(item, str)
                and item.startswith("#")
                else _relocate_refs(item, prefix)
            )
            for key, item in value.items()
        }
    return value
