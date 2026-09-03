"""算子体系的契约。每一条都对应设计文档里一个被点名的翻车点。"""

import ast
import re
from pathlib import Path
from typing import Any, cast

import pytest

from platform_server.apps.dataset.protocols import (
    AGG_FUNCS as LEDGER_AGG_FUNCS,
)
from platform_server.apps.modeling.operators import (
    AGG_FUNCS,
    CATEGORIES,
    CONTRACTS,
    SERVING_CHANNELS,
    Frame,
    FrameColumn,
    OperatorBase,
    OperatorRegistryError,
    registry,
)
from platform_server.apps.modeling.operators.base import PREFETCHED_KEY
from platform_server.apps.modeling.operators.cleaning import (
    _FOLDERS as FOLDERS,
)

# 本期算子的**写死名单**。加算子必须同时改这里——防的是重名静默覆盖与漏登记
EXPECTED_CODES = (
    "cast_type",
    "classification_metrics",
    "clip_outlier",
    "drop_missing",
    "feature_importance",
    "fill_missing",
    "filter_rows",
    "lag_feature",
    "ledger_source",
    "linear_regression",
    "logistic_regression",
    "one_hot",
    "regression_metrics",
    "resample",
    "residual_analysis",
    "rolling_feature",
    "split_dataset",
    "standardize",
    "time_feature",
)
# 带「跑用户给的东西」意味的词。撞上就该来读一遍设计文档 §9.3
CODE_EXECUTION_WORDS = ("custom", "code", "script", "eval", "exec", "shell")
# 全模块不许出现的名字：它们各自都是一条任意代码执行或上传通道
FORBIDDEN_NAMES = ("eval(", "exec(", "importlib", "__import__", "UploadFile")
# 算子参数允许的字段类型。自由文本只许当标签或列 key
ALLOWED_CONFIG_TYPES = ("string", "integer", "number", "boolean", "array")
# 参数 schema 上的控件标记，与算子侧的 `column_field` / `table_field` 同一个键
WIDGET_KEY = "x-dt-widget"
COLUMN_WIDGET = "column"
TABLE_WIDGET = "table"

MODELING_ROOT = (
    Path(__file__).resolve().parents[2]
    / "src"
    / "platform_server"
    / "apps"
    / "modeling"
)
# 前端的图标注册表。算子的 ICON 取自它，而**取错了是纯静默的**：
# `DtIcon` 拿到未登记的名字什么都不渲染，画布上那格就是空的
ICON_REGISTRY = (
    Path(__file__).resolve().parents[5]
    / "web"
    / "packages"
    / "ui"
    / "src"
    / "components"
    / "DtIcon"
    / "registry.ts"
)
# 注册表里一行一个名字：`  name: [` 或 `  'name-with-dash': [`
ICON_NAME = re.compile(r"^  '?([a-z][a-z0-9-]*)'?:", re.MULTILINE)


def sources() -> list[Path]:
    """建模模块的全部源码。"""
    return sorted(MODELING_ROOT.rglob("*.py"))


def test_the_registry_matches_the_written_roster() -> None:
    """注册表与写死的名单逐字一致。"""
    assert registry.codes() == EXPECTED_CODES


def test_a_duplicate_code_raises_instead_of_overwriting() -> None:
    """重名抛错而不是覆盖——覆盖会让打错一个字符悄悄顶掉别的算子且 CI 全绿。"""

    class Clash(OperatorBase):
        CODE = "standardize"
        NAME = "撞名"
        CATEGORY = "feature"

    with pytest.raises(OperatorRegistryError):
        registry.register(Clash)


def test_every_operator_exposes_its_ports() -> None:
    """目录必须吐端口：吐不出来的话前端画布只能自己硬编码一份端口拓扑。"""
    for spec in registry.specs():
        names = [port.name for port in (*spec.inputs, *spec.outputs)]
        assert names, spec.code
        # ⚠ 唯一性各管各的一侧：输入与输出可以同名（进一个帧、出一个帧），
        # 连线靠边上的两个端口名各自寻址，不会混
        for side in (spec.inputs, spec.outputs):
            side_names = [port.name for port in side]
            assert len(side_names) == len(set(side_names)), spec.code
        assert PREFETCHED_KEY not in names, spec.code


def test_every_port_declares_a_known_contract() -> None:
    """契约字符串是唯一的类型判据，不许出现名单外的值。"""
    for spec in registry.specs():
        for port in (*spec.inputs, *spec.outputs):
            assert port.contract in CONTRACTS, spec.code


def test_every_operator_declares_a_known_category() -> None:
    """分类与前端算子面板的分组一一对应。"""
    for spec in registry.specs():
        assert spec.category in CATEGORIES, spec.code


def test_all_five_categories_are_covered() -> None:
    """五类环节各至少有一个算子——这是「能搭出一条完整流水线」的下限。"""
    covered = {spec.category for spec in registry.specs()}
    assert covered == set(CATEGORIES)


def test_only_model_operators_declare_a_serving_channel() -> None:
    """产模型的必须声明通道，不产模型的必须留空。"""
    for spec in registry.specs():
        produces = any(port.contract == "model@v1" for port in spec.outputs)
        if produces:
            assert spec.serving_channel in SERVING_CHANNELS, spec.code
        else:
            assert spec.serving_channel == "", spec.code


def test_every_operator_declares_the_columns_it_produces() -> None:
    """列声明只给帧类输出端口建键，不多不少。

    ⚠ 少一个端口，下游的列候选就是空的；多一个（比如给模型端口也建了键），
    发布期那道「声明 = 实测」的核对会拿一个根本不是帧的端口去比
    （docs/MODELING_PLATFORM_DESIGN.md D2）。
    """
    for code in EXPECTED_CODES:
        operator = registry.get(code)
        frame_ports = {
            port.name
            for port in operator.OUTPUTS
            if port.contract == "frame@v1"
        }
        declared = operator.describe_columns(
            _least_config(code),
            {port.name: ("甲", "乙") for port in operator.INPUTS},
        )
        assert set(declared) == frame_ports, code


def test_column_declarations_keep_their_order() -> None:
    """透传型算子必须保持列序，不许排序或去重后重排。

    ⚠ 绑定是**按位置**把形参映射到特征上的：顺序一变，存量绑定就静默错位——
    温度喂进了负荷那一格，算出来的还是个数，没有任何一处会报错。
    """
    given = ("乙", "甲", "丙")
    for code in ("fill_missing", "standardize"):
        declared = registry.get(code).describe_columns(
            _least_config(code), {"frame": given}
        )
        assert declared["frame"] == given, code


def test_the_aggregation_roster_matches_the_ledger() -> None:
    """重采样那八档与台账的八档**同集合**。

    ⚠ 建模不许深链 `apps/dataset/protocols`，所以两边各出一份白名单——那就必须
    有一条用例钉住它们不漂。漂了的表现是「台账里按小时看是一个数、建模里按小时
    取是另一个数」，两边各自都对。
    """
    assert AGG_FUNCS == LEDGER_AGG_FUNCS


def test_every_aggregation_has_a_way_to_fold() -> None:
    """名单里的每一档都在折算表里有对应的算法。

    ⚠ 折算表少一个键不会在登记期报错，要跑到那一档才 KeyError——而那时候用户
    已经配好图按下运行了。
    """
    assert set(AGG_FUNCS) - {"count"} == set(FOLDERS)


def test_every_operator_icon_is_registered_on_the_front_end() -> None:
    """算子的图标名必须在 `DtIcon` 的注册表里。

    ⚠ 这条只能在这里守：图标名是**运行期数据**，不进 openapi，前端那条「用到的
    每个名字都在表里」的用例看不见它。写错了 `DtIcon` 什么都不渲染，画布上那一格
    就是空的，两侧都不报错。
    """
    registered = set(
        ICON_NAME.findall(ICON_REGISTRY.read_text(encoding="utf-8"))
    )
    assert registered, "图标注册表读出来是空的，路径大概挪了"
    for spec in registry.specs():
        assert (
            spec.icon in registered
        ), f"{spec.code} 的图标「{spec.icon}」没登记"


def test_config_schemas_only_use_closed_types() -> None:
    """参数类型闭合。

    不许出现语义是「一段表达式 / 一个路径 / 一个模块名」的自由文本字段。
    """
    for spec in registry.specs():
        for name, field in _properties(spec.config_schema).items():
            resolved = _resolved(spec.config_schema, field)
            assert (
                _kind_of(resolved) in ALLOWED_CONFIG_TYPES
            ), f"{spec.code}.{name}"


def test_enumerated_fields_are_declared_as_enums() -> None:
    """取值集合要落在 schema 的 enum 上。

    ⚠ 只写在 description 里、字段却是裸 string 的话，前端会渲染成自由文本框，
    用户能敲出合法值之外的东西、要等后端 422 才知道。
    """
    for spec in registry.specs():
        for name, field in _properties(spec.config_schema).items():
            described = str(field.get("description", ""))
            resolved = _resolved(spec.config_schema, field)
            if "=" not in described or _kind_of(resolved) != "string":
                continue
            assert "enum" in resolved, f"{spec.code}.{name}"


def test_every_enum_value_is_explained_in_its_description() -> None:
    """枚举字段的 description 要给全每个取值的 `值=说明`。

    ⚠ 前端按这个形状取下拉文案，只要有一个取值对不上就**整份丢掉**、退回显示
    英文原值（web/app/src/pages/Modeling/Canvas/scripts/schemaForm.ts）。
    """
    for spec in registry.specs():
        for name, field in _properties(spec.config_schema).items():
            resolved = _resolved(spec.config_schema, field)
            explained = _explained(str(field.get("description", "")))
            for value in resolved.get("enum", []):
                assert value in explained, f"{spec.code}.{name}:{value}"


def test_column_references_are_either_one_column_or_a_list_of_them() -> None:
    """列引用字段只有单值与列表两种形状。

    ⚠ 前端按这个形状分派控件：单值渲染下拉、列表渲染多选。冒出第三种形状时它
    会掉进兜底的自由文本框，而用户能敲进去任何东西，要到运行那一刻才报错
    （web/app/src/pages/Modeling/Canvas/scripts/schemaForm.ts）。
    """
    for spec in registry.specs():
        for name, field in _properties(spec.config_schema).items():
            if field.get(WIDGET_KEY) != COLUMN_WIDGET:
                continue
            kind = _kind_of(_resolved(spec.config_schema, field))
            assert kind in ("string", "array"), f"{spec.code}.{name}"
            if kind == "array":
                items = field.get("items", {})
                assert _kind_of(items) == "string", f"{spec.code}.{name}"


def test_a_required_table_reference_rejects_an_empty_code() -> None:
    """必填的台账引用不许是空串。

    ⚠ 空串是合法的 `str`：不给长度下限的话，一个还没选台账的取数节点整份图校验
    全绿，要跑到取数那一步才报「台账不存在」，而那时整次运行已经失败。
    """
    for spec in registry.specs():
        for name, field in _properties(spec.config_schema).items():
            if field.get(WIDGET_KEY) != TABLE_WIDGET:
                continue
            if name not in spec.config_schema.get("required", []):
                continue
            assert field.get("minLength") == 1, f"{spec.code}.{name}"


def test_no_operator_code_smells_of_running_user_code() -> None:
    """算子码里不许出现带代码执行意味的词。

    这条看着像形式主义，它的作用是让「加一个自定义代码算子」在 CI 上撞一次墙。
    """
    for code in registry.codes():
        assert not any(word in code for word in CODE_EXECUTION_WORDS), code


def test_the_module_has_no_code_execution_surface() -> None:
    """全模块不出现 eval / exec / importlib / 文件上传形参。"""
    offenders = [
        f"{path.name}:{name}"
        for path in sources()
        for name in FORBIDDEN_NAMES
        if name in path.read_text(encoding="utf-8")
    ]
    assert offenders == []


def test_fitted_params_are_keyed_by_column_key() -> None:
    """拟合参数一律按列 key 建键，出现整数键即红。

    按列索引建键是参考实现最严重的一处静默错误：训练期与推理期列序不同时，
    错位的变换照样施加，结果是无异常、无告警的错误预测。
    """
    frame = _tiny_frame()
    for code in ("fill_missing", "standardize"):
        operator, _ = registry.build(code, {})
        operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
        operator.run({"frame": frame})
        for key in operator.dump_fitted() or {}:
            assert isinstance(key, str), code
            assert not key.isdigit(), code


def test_fitted_params_round_trip() -> None:
    """导出的拟合参数必须能被自己的校验器接受——校验器不许比生成器更严。"""
    frame = _tiny_frame()
    for code in ("fill_missing", "standardize"):
        operator, _ = registry.build(code, {})
        operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
        operator.run({"frame": frame})
        dumped = operator.dump_fitted() or {}
        registry.get(code).validate_fitted(dumped)
        assert dumped, code


def test_no_lazy_imports_hide_a_cycle() -> None:
    """模块里不许有函数内 import：惰性只是把编译期的环藏到运行期。"""
    offenders: list[str] = []
    for path in sources():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        offenders += [
            f"{path.name}:{child.lineno}"
            for parent in ast.walk(tree)
            if isinstance(parent, (ast.FunctionDef, ast.AsyncFunctionDef))
            for child in ast.walk(parent)
            if isinstance(child, (ast.Import, ast.ImportFrom))
        ]
    assert offenders == []


def test_the_engine_never_keys_context_by_alias() -> None:
    """执行引擎不许拿别名当上下文键：别名没有唯一约束，同名会静默互相覆盖。"""
    source = (MODELING_ROOT / "services" / "run_executor.py").read_text(
        encoding="utf-8"
    )
    assert not re.search(r"\[\s*[a-z_]*\.alias", source)


def _tiny_frame() -> Frame:
    return Frame(
        columns=(
            FrameColumn(key="甲", name="甲", dtype="number"),
            FrameColumn(key="乙", name="乙", dtype="number"),
        ),
        rows=((1.0, 2.0), (3.0, 5.0), (None, 8.0)),
    )


def _explained(description: str) -> set[str]:
    """描述里被 `值=说明` 讲到的那些取值。

    Args: description。
    """
    parts = re.split(r"[；;]", description)
    return {
        part.split("=", 1)[0].strip() for part in parts if part.find("=") > 0
    }


def _properties(schema: dict[str, Any]) -> dict[str, dict[str, Any]]:
    raw = schema.get("properties", {})
    return raw if isinstance(raw, dict) else {}


def _resolved(schema: dict[str, Any], field: dict[str, Any]) -> dict[str, Any]:
    """把 `$ref` 指向 `$defs` 的那一层展开。

    ⚠ `Literal` 别名在 pydantic 里会生成一个 `$defs` 条目 + 一个 `$ref`，
    不展开的话看到的 `type` 是空的，这条闸就成了摆设。
    Args: schema, field。
    """
    ref = field.get("$ref")
    if not isinstance(ref, str):
        return field
    defs = schema.get("$defs", {})
    name = ref.rsplit("/", 1)[-1]
    target = defs.get(name) if isinstance(defs, dict) else None
    return target if isinstance(target, dict) else field


def _kind_of(field: dict[str, Any]) -> str:
    if "enum" in field:
        return "string"
    kind = field.get("type")
    if isinstance(kind, str):
        return kind
    for branch in field.get("anyOf", []):
        if isinstance(branch, dict) and branch.get("type") != "null":
            return str(branch.get("type", ""))
    return ""


def _least_config(code: str) -> Any:
    """填够必填项的最小参数。

    ⚠ 必填项各算子不同，不能一律 `CONFIG_MODEL()`：台账取数的 `table_code`
    没有默认值（空串会被 `min_length` 拒掉，那正是它该有的样子）。
    Args: code。
    """
    least: dict[str, Any] = {
        "table_code": "t",
        "target_column": "甲",
        "column": "甲",
    }
    schema: dict[str, Any] = registry.get(code).CONFIG_MODEL.model_json_schema()
    required = cast("list[str]", schema.get("required", []))
    return registry.get(code).CONFIG_MODEL.model_validate(
        {name: least[name] for name in required if name in least}
    )
