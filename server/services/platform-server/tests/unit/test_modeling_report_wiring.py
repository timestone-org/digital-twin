"""讲解从算子回到接口这条缝：子进程回传、执行器记账、落库、出接口。

⚠ 位置必须是 `NodeResult`：算子实例跑在子进程里、用完即弃，执行器那边再也拿
不回来（docs/MODELING_RESULT_VIEW_DESIGN.md §4.4）。
"""

import uuid
from dataclasses import replace
from typing import Any

import pytest

from platform_server.apps.modeling.models import ModelingNodeRun
from platform_server.apps.modeling.operators import (
    CONTRACT_FRAME,
    OperatorBase,
    OperatorRegistry,
    PortSpec,
    registry,
)
from platform_server.apps.modeling.operators.reporting import (
    TIER_SCALAR,
    ReportBlock,
)
from platform_server.apps.modeling.services import (
    node_task,
    presenters,
    run_dispatch,
)
from platform_server.apps.modeling.services.node_task import (
    NodePayload,
    NodeResult,
)
from platform_server.apps.modeling.services.run_executor import (
    NodeOutcome,
    RunOutcome,
    execute_graph,
)
from unit.modeling_fakes import (
    DirectRunner,
    execution_of,
    linear_frame,
    linear_graph,
)

GIST = ReportBlock(
    kind="rows",
    zone="step",
    port="",
    title="这一步做了什么",
    tier=TIER_SCALAR,
    payload={"before": 10, "after": 10},
)


class ReportingRunner:
    """在真跑法上再挂一块讲解的假跑法。"""

    def __init__(self, blocks: tuple[ReportBlock, ...]) -> None:
        self._blocks = blocks
        self._direct = DirectRunner()

    async def run(self, payload: NodePayload) -> NodeResult:
        """照跑，再把讲解挂在结果上。

        Args: payload。
        """
        return replace(await self._direct.run(payload), report=self._blocks)


class TalkativeOperator(OperatorBase):
    """一个真会讲话的算子：跑完之后交出一块。

    24 个真算子今天全走基类那个「一块都不讲」的缺省，缺省值证不了这条缝还在。
    """

    CODE = "talkative_probe"
    NAME = "会讲话的探针"
    CATEGORY = "preprocess"
    INPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME),)
    OUTPUTS = (PortSpec(name="frame", contract=CONTRACT_FRAME),)

    def run(self, inputs: dict[str, Any]) -> dict[str, Any]:
        """原样透传：这个算子的全部本事就是讲那一块。

        Args: inputs。
        """
        return dict(inputs)

    def report(self) -> tuple[ReportBlock, ...]:
        """跑完之后要讲的那一块。"""
        return (GIST,)


def talkative_registry() -> OperatorRegistry:
    """只登记了那个会讲话的算子的一本花名册。

    ⚠ 不往进程内那本全局花名册里塞：用例随机序下别的用例会看见一个名单外的
    算子，而目录契约照的是那本名册。
    """
    isolated = OperatorRegistry()
    isolated.register(TalkativeOperator)
    return isolated


async def run_with(runner: object) -> RunOutcome:
    """拿指定跑法跑一遍最小闭环。

    Args: runner。
    """
    return await execute_graph(
        linear_graph(),
        execution=execution_of(runner, frames={"s": linear_frame(50)}),
    )


def test_the_result_carries_no_report_unless_the_operator_makes_one() -> None:
    """缺省是一块都不讲——24 个算子今天全走这条路。"""
    assert NodeResult(outputs={}).report == ()


def test_every_registered_operator_answers_the_report_call() -> None:
    """每个算子都答得出这个问题，答不出的会在跑完那一刻抛。"""
    for code in registry.codes():
        assert hasattr(registry.get(code), "report")


def test_the_subprocess_asks_the_operator_what_to_say(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⚠ 子进程那一步必须**向算子取**讲解，否则全部算子的块一声不吭地落 NULL。

    界面于是退回升级前的样子，而单元、契约、E2E 全绿——今天 24 个算子的缺省
    都是空元组，只有一个真讲话的算子问得出这个问题
    （docs/MODELING_RESULT_VIEW_DESIGN.md §11 R-4）。
    """
    monkeypatch.setattr(node_task, "registry", talkative_registry())
    result = node_task.run_node_payload(
        NodePayload(
            operator="talkative_probe",
            config={},
            inputs={"frame": linear_frame(5)},
            tz_offset_minutes=0,
            split_plan=None,
        )
    )
    assert result.report == (GIST,)
    assert result.io["outputs"] == {"frame": ["温度", "负荷", "能耗"]}


async def test_a_step_that_says_nothing_leaves_the_column_null() -> None:
    """不讲话的算子落 NULL，绝不落空壳：空壳会让界面摆出一片空白的分区。

    ⚠ 不点名哪几步不讲话：24 个算子的 `report()` 分批补，点名的那份名单每补
    一个就红一次，而红的原因与这条缝无关。
    """
    outcome = await run_with(DirectRunner())
    shells = [
        node.operator
        for node in outcome.nodes
        if node.report is not None and not node.report["blocks"]
    ]
    assert shells == []


async def test_a_step_that_talks_lands_its_blocks_through_the_real_runner() -> (
    None
):
    """真跑法上，取数那一步的讲解一路走到落库那份 JSON。"""
    outcome = await run_with(DirectRunner())
    source = next(
        node for node in outcome.nodes if node.operator == "ledger_source"
    )
    assert source.report is not None
    assert [block["kind"] for block in source.report["blocks"]] == [
        "rows",
        "columns",
        "bins",
        "axis",
    ]


async def test_blocks_made_in_the_subprocess_reach_the_outcome() -> None:
    """算子在子进程里造的块，跟着 `NodeResult` 一路走到落库那一步。"""
    outcome = await run_with(ReportingRunner((GIST,)))
    reports = [node.report for node in outcome.nodes]
    assert all(report is not None for report in reports)
    first = reports[0]
    assert first is not None
    assert first["blocks"][0]["title"] == "这一步做了什么"
    assert first["blocks"][0]["payload"] == {"before": 10, "after": 10}


async def test_the_report_budget_is_separate_from_the_preview_one() -> None:
    """两本账各记各的：讲解落了，摘要一份不少。"""
    outcome = await run_with(ReportingRunner((GIST,)))
    assert all(node.preview for node in outcome.nodes)
    assert all(node.report for node in outcome.nodes)


def test_the_row_written_to_the_database_carries_the_report() -> None:
    """落库那一行带上讲解——这一跳漏了的话，前面全白算。"""
    node = NodeOutcome(
        node_id="n1",
        operator="fill_missing",
        alias="",
        ordinal=0,
        status="succeeded",
        report={"blocks": [], "dropped": [], "note": ""},
    )
    row = run_dispatch._node_row(uuid.uuid4(), node, None, None)
    assert row.report_json == {"blocks": [], "dropped": [], "note": ""}


def node_row(**columns: object) -> ModelingNodeRun:
    """造一行节点记录。

    Args: columns。
    """
    return ModelingNodeRun(
        run_id=uuid.uuid4(),
        node_id="n1",
        operator="fill_missing",
        alias=None,
        ordinal=0,
        status="succeeded",
        duration_ms=1,
        preview_truncated=False,
        **columns,
    )


def test_an_old_row_without_a_report_comes_out_as_null() -> None:
    """⚠ 存量兼容：这一步之前的运行两列全是 NULL，接口照出、界面退化成从前。"""
    out = presenters.to_node_out(node_row())
    assert out.report is None
    assert out.fitted is None


def test_the_fitted_column_finally_has_a_read_side() -> None:
    """拟合参数出接口了：那一列独立成列是怕摘要削掉它，不是不让看。"""
    out = presenters.to_node_out(
        node_row(
            fitted_json={"温度": {"center": 20.0, "scale": 3.0}},
            report_json={"blocks": [], "dropped": [], "note": ""},
        )
    )
    assert out.fitted == {"温度": {"center": 20.0, "scale": 3.0}}
    assert out.report == {"blocks": [], "dropped": [], "note": ""}
