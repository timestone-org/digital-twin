"""从 platform OpenAPI 生成建模命令与枚举契约。"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

from scripts.export_report_types import OpenApi, type_of

ROOT = Path(__file__).resolve().parents[4]
OUTPUT = ROOT / "web/packages/contracts/src/modelingManagement.ts"
ALIASES = (
    ("CommandFailureOut", "ModelingCommandFailure"),
    ("ModelingCommandOut", "ModelingCommand"),
)
REFERENCES = (
    *ALIASES,
    ("FieldErrorOut", "FieldError"),
    ("JsonValue", "ModelingJsonValue"),
)
ENUMS = (
    ("operation", "MODELING_COMMAND_OPERATIONS", "ModelingCommandOperation"),
    ("state", "MODELING_COMMAND_STATES", "ModelingCommandState"),
)


def render() -> str:
    schema = OpenApi.model_validate_json(
        (ROOT / "server/services/platform-server/openapi.json").read_text()
    )
    rows = [
        "/** @fileoverview 从 platform OpenAPI 生成的" "建模命令契约。 */",
        "import type { FieldError } from './envelope'",
        "import type { ModelingJsonValue } from './modelingDetection'",
    ]
    command = schema.components.schemas["ModelingCommandOut"]
    for field, constant, alias in ENUMS:
        values = command.properties[field].enum
        rows.append(f"export const {constant} = {json.dumps(values)} as const")
        rows.append(f"export type {alias} = (typeof {constant})[number]\n")
    for name, alias in ALIASES:
        shape = type_of(schema.components.schemas[name])
        for original, target in REFERENCES:
            shape = shape.replace(f'ReportSchemas["{original}"]', target)
        rows.append(f"export type {alias} = {shape}\n")
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        raise RuntimeError("生成契约需要 pnpm")
    # 固定本地 pnpm 与 formatter 参数，无外部命令输入。
    return subprocess.run(  # noqa: S603
        [pnpm, "exec", "prettier", "--stdin-filepath", str(OUTPUT)],
        input="\n".join(rows),
        text=True,
        capture_output=True,
        check=True,
        timeout=60,
        cwd=ROOT / "web",
    ).stdout


def main() -> None:
    made = render()
    if "--check" in sys.argv:
        if OUTPUT.read_text() != made:
            raise SystemExit("建模管理生成契约与 OpenAPI 不一致")
    else:
        OUTPUT.write_text(made)


if __name__ == "__main__":
    main()
