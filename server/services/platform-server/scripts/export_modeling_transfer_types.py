"""从 platform OpenAPI 生成流水线迁移契约。"""

import shutil
import subprocess
import sys
from pathlib import Path

from scripts.export_report_types import OpenApi, type_of

ROOT = Path(__file__).resolve().parents[4]
OUTPUT = ROOT / "web/packages/contracts/src/modelingTransfer.ts"
ALIASES = (
    ("PipelineTransferDocument", "ModelingTransferDocument"),
    ("PipelineImportIn", "ModelingPipelineImportInput"),
    ("PipelineImportInspection", "ModelingImportInspection"),
    ("TransferPipeline", "ModelingTransferPipeline"),
    ("TransferOperator", "ModelingTransferOperator"),
    ("TransferIssue", "ModelingTransferIssue"),
)
REFERENCES = (*ALIASES, ("PipelineGraph", "ModelingGraph"))


def render() -> str:
    schema = OpenApi.model_validate_json(
        (ROOT / "server/services/platform-server/openapi.json").read_text()
    )
    rows = [
        "/** @fileoverview 从 platform OpenAPI 生成的流水线迁移契约。 */",
        "import type { ModelingGraph } from './modeling'",
    ]
    for name, alias in ALIASES:
        shape = type_of(schema.components.schemas[name])
        for original, target in REFERENCES:
            shape = shape.replace(f'ReportSchemas["{original}"]', target)
        rows.append(f"export type {alias} = {shape}\n")
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        raise RuntimeError("生成契约需要 pnpm")
    return subprocess.run(  # noqa: S603
        [
            pnpm,
            "--pm-on-fail=ignore",
            "exec",
            "prettier",
            "--stdin-filepath",
            str(OUTPUT),
        ],
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
            raise SystemExit("流水线迁移契约与 OpenAPI 不一致")
    else:
        OUTPUT.write_text(made)


if __name__ == "__main__":
    main()
