"""从 platform OpenAPI 生成点位语义检索契约。"""

import shutil
import subprocess
import sys
from pathlib import Path

from scripts.export_report_types import OpenApi, type_of

ROOT = Path(__file__).resolve().parents[4]
OUTPUT = ROOT / "web/packages/contracts/src/collectSearch.ts"


def render() -> str:
    schema = OpenApi.model_validate_json(
        (ROOT / "server/services/platform-server/openapi.json").read_text()
    )
    rows = ["/** @fileoverview 从 platform OpenAPI 生成的点位语义检索契约。 */"]
    for name in ("PointMatchOut", "PointMatchesOut"):
        shape = type_of(schema.components.schemas[name])
        shape = shape.replace('ReportSchemas["PointMatchOut"]', "PointMatchOut")
        rows.append(f"export type {name} = {shape}\n")
    raw = "\n".join(rows)
    pnpm = shutil.which("pnpm")
    if pnpm is None:
        raise RuntimeError("生成契约需要 pnpm")
    # 固定本地 formatter 与参数，不接受外部命令。
    return subprocess.run(  # noqa: S603
        [pnpm, "exec", "prettier", "--stdin-filepath", str(OUTPUT)],
        input=raw,
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
            raise SystemExit("点位检索契约与 OpenAPI 不一致")
    else:
        OUTPUT.write_text(made)


if __name__ == "__main__":
    main()
