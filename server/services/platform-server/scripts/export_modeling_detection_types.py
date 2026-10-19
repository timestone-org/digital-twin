"""从 platform OpenAPI 生成设备异常检测契约。"""

import shutil
import subprocess
import sys
from pathlib import Path

from scripts.export_report_types import OpenApi, type_of

ROOT = Path(__file__).resolve().parents[4]
OUTPUT = ROOT / "web/packages/contracts/src/modelingDetection.ts"
ALIASES = (
    ("DetectionRow", "DetectionRow"),
    ("AnomalyDecisionOut", "AnomalyDecision"),
    ("OpenModelDetectOut", "OpenModelDetect"),
    ("OpenModelDetectIn", "OpenModelDetectRequest"),
)
REFERENCES = (
    *ALIASES,
    ("FiniteSensor", "number"),
    ("OpenModelInfoOut", "OpenModelInfo"),
    ("OpenModelWarningOut", "OpenModelWarning"),
)


def render() -> str:
    schema = OpenApi.model_validate_json(
        (ROOT / "server/services/platform-server/openapi.json").read_text()
    )
    rows = [
        "/** @fileoverview 从 platform OpenAPI 生成的异常检测契约。 */",
        "import type { OpenModelInfo, OpenModelWarning } from './modeling'",
    ]
    for name, alias in ALIASES:
        shape = type_of(schema.components.schemas[name])
        for original, target in REFERENCES:
            shape = shape.replace(f'ReportSchemas["{original}"]', target)
        shape = shape.replace("number | number", "number")
        rows.append(f"export type {alias} = {shape}\n")
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        raise RuntimeError("生成契约需要 pnpm")
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
            raise SystemExit("异常检测契约与 OpenAPI 不一致")
    else:
        OUTPUT.write_text(made)


if __name__ == "__main__":
    main()
