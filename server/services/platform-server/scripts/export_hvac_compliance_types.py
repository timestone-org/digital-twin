"""从 platform OpenAPI 生成空调季节达标契约。"""

import shutil
import subprocess
import sys
from pathlib import Path

from scripts.export_report_types import OpenApi, type_of

ROOT = Path(__file__).resolve().parents[4]
OUTPUT = ROOT / "web/packages/contracts/src/hvacCompliance.ts"
NAMES = (
    "MetricLimitIn",
    "MetricLimitOut",
    "WinterPeriodIn",
    "CompliancePolicyIn",
    "CompliancePolicyOut",
    "EffectiveComplianceOut",
)
ALIASES = (
    ("AcCompliancePolicyInput", "CompliancePolicyIn"),
    ("AcCompliancePolicy", "CompliancePolicyOut"),
    ("AcEffectiveCompliance", "EffectiveComplianceOut"),
    ("AcWinterPeriod", "WinterPeriodIn"),
)


def render() -> str:
    schema = OpenApi.model_validate_json(
        (ROOT / "server/services/platform-server/openapi.json").read_text()
    )
    rows = [
        "/** @fileoverview 从 platform OpenAPI 生成的空调季节达标契约。 */",
        "export interface HvacComplianceSchemas {",
    ]
    for name in NAMES:
        shape = type_of(schema.components.schemas[name]).replace(
            "ReportSchemas", "HvacComplianceSchemas"
        )
        rows.append(f'  "{name}": {shape}')
    rows.append("}")
    rows.extend(
        f'export type {alias} = HvacComplianceSchemas["{name}"]'
        for alias, name in ALIASES
    )
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        raise RuntimeError("生成契约需要 pnpm")
    return subprocess.run(  # noqa: S603 - 固定本地格式化命令
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
            raise SystemExit("季节达标契约与 OpenAPI 不一致")
    else:
        OUTPUT.write_text(made)


if __name__ == "__main__":
    main()
