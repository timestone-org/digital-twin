"""从已提交 OpenAPI 生成报告 TypeScript 契约。"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, JsonValue

ROOT = Path(__file__).resolve().parents[4]
SPEC = ROOT / "server/services/platform-server/openapi.json"
OUTPUT = ROOT / "web/packages/contracts/src/report.ts"
ROOTS = (
    "ReportTemplateCreateIn",
    "TemplateUpdateIn",
    "ReportTemplateOut",
    "ReportTemplateSummaryOut",
    "TemplateBody",
    "DocumentNode",
    "MetricDef",
    "PageSettings",
    "PreviewIn",
    "PreviewOut",
    "RenderCreateIn",
    "RenderOut",
    "RenderDetailOut",
    "ScheduleCreateIn",
    "ScheduleUpdateIn",
    "ScheduleOut",
    "ReportRuntimeOut",
    "ImportResultOut",
    "ValidationOut",
    "ImportTicketOut",
    "ImportTicketIn",
    "ImportStartIn",
)
ALIASES = (
    ("ReportTemplate", "ReportTemplateOut"),
    ("ReportTemplateSummary", "ReportTemplateSummaryOut"),
    ("ReportTemplateCreate", "ReportTemplateCreateIn"),
    ("ReportTemplateUpdate", "TemplateUpdateIn"),
    ("ReportBody", "TemplateBody"),
    ("ReportDocument", "DocumentNode"),
    ("ReportMetric", "MetricDef"),
    ("ReportPage", "PageSettings"),
    ("ReportPreview", "PreviewOut"),
    ("ReportRender", "RenderOut"),
    ("ReportRenderDetail", "RenderDetailOut"),
    ("ReportSchedule", "ScheduleOut"),
    ("ReportScheduleCreate", "ScheduleCreateIn"),
    ("ReportScheduleUpdate", "ScheduleUpdateIn"),
)


class Schema(BaseModel):
    """生成器消费的 JSON Schema 子集。"""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)
    ref: str | None = Field(default=None, alias="$ref")
    type: str | None = None
    const: JsonValue = None
    enum: list[JsonValue] = Field(default_factory=list[JsonValue])
    any_of: list["Schema"] = Field(
        default_factory=list["Schema"], alias="anyOf"
    )
    all_of: list["Schema"] = Field(
        default_factory=list["Schema"], alias="allOf"
    )
    items: "Schema | None" = None
    properties: dict[str, "Schema"] = Field(default_factory=dict[str, "Schema"])
    required: list[str] = Field(default_factory=list[str])
    additional: "Schema | bool | None" = Field(
        default=None, alias="additionalProperties"
    )


class Components(BaseModel):
    schemas: dict[str, Schema]


class OpenApi(BaseModel):
    components: Components


def dependencies(schema: Schema) -> list[Schema]:
    children = [*schema.properties.values(), *schema.any_of, *schema.all_of]
    if schema.items:
        children.append(schema.items)
    if isinstance(schema.additional, Schema):
        children.append(schema.additional)
    return children


def referenced(schemas: dict[str, Schema]) -> set[str]:
    found: set[str] = set(ROOTS)
    pending = [schemas[name] for name in ROOTS]
    while pending:
        schema = pending.pop()
        if schema.ref:
            name = schema.ref.rsplit("/", 1)[-1]
            if name not in found:
                found.add(name)
                pending.append(schemas[name])
        pending.extend(dependencies(schema))
    return found


def type_of(schema: Schema) -> str:
    if schema.ref:
        return f"ReportSchemas[{json.dumps(schema.ref.rsplit('/', 1)[-1])}]"
    if "const" in schema.model_fields_set:
        return json.dumps(schema.const)
    if schema.enum:
        return " | ".join(json.dumps(value) for value in schema.enum)
    if schema.any_of:
        return " | ".join(type_of(value) for value in schema.any_of)
    if schema.all_of:
        return " & ".join(type_of(value) for value in schema.all_of)
    return structural_type(schema)


def structural_type(schema: Schema) -> str:
    if schema.type == "array":
        return f"({type_of(schema.items or Schema())})[]"
    if schema.type == "object":
        return object_type(schema)
    kinds = {
        "string": "string",
        "number": "number",
        "integer": "number",
        "boolean": "boolean",
        "null": "null",
    }
    return kinds.get(schema.type or "", "unknown")


def object_type(schema: Schema) -> str:
    if schema.properties:
        fields = [
            f"{json.dumps(name)}{'' if name in schema.required else '?'}: "
            f"{type_of(value)}"
            for name, value in schema.properties.items()
        ]
        return "{ " + "; ".join(fields) + " }"
    value = (
        type_of(schema.additional)
        if isinstance(schema.additional, Schema)
        else "unknown"
    )
    return f"Record<string, {value}>"


def render(schemas: dict[str, Schema]) -> str:
    fields = [
        f"{json.dumps(name)}: {type_of(schemas[name])};"
        for name in sorted(referenced(schemas))
    ]
    aliases = [
        f"export type {name} = ReportSchemas[{json.dumps(target)}];"
        for name, target in ALIASES
    ]
    source = (
        "/** @fileoverview 从 platform OpenAPI 生成的报告契约。 */\n"
        "export interface ReportSchemas {\n"
        + "\n".join(fields)
        + "\n}\n"
        + "\n".join(aliases)
        + "\n"
    )
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        raise RuntimeError("请先将 pnpm 加入 PATH")
    # 固定本地 pnpm 与 formatter 参数，无外部命令输入。
    result = subprocess.run(  # noqa: S603
        [pnpm, "exec", "prettier", "--parser", "typescript"],
        input=source,
        text=True,
        capture_output=True,
        check=True,
        cwd=ROOT / "web",
        timeout=60,
    )
    return result.stdout


def main() -> None:
    content = render(
        OpenApi.model_validate_json(SPEC.read_text()).components.schemas
    )
    if "--check" in sys.argv:
        if OUTPUT.read_text() != content:
            raise SystemExit("报告前端类型与 OpenAPI 不一致")
        return
    OUTPUT.write_text(content)


if __name__ == "__main__":
    main()
