"""导出 `openapi.json` 并提交进仓。

它是前后端之间唯一的类型真源：CI 重新生成后与仓库中的文件逐字节比对，
不一致即失败——让「改了接口忘了同步」变成红灯，而不是运行时惊喜。
"""

import json
import sys
from pathlib import Path
from typing import Any

from pydantic import SecretStr

from auth_server.app import build_app
from auth_server.settings import Settings

OUTPUT = Path(__file__).resolve().parent.parent / "openapi.json"

# ⚠ 这些占位值只在导出进程里存在，绝不能出现在运行时配置里。
_PLACEHOLDER = "openapi-export"
_PLACEHOLDER_SECRET = SecretStr("x" * 32)


def _export_settings() -> Settings:
    """导出只需要一个能构造出来的配置对象，不连任何依赖。"""
    return Settings(
        postgres_host=_PLACEHOLDER,
        postgres_user=_PLACEHOLDER,
        postgres_password=SecretStr(_PLACEHOLDER),
        postgres_db=_PLACEHOLDER,
        redis_host=_PLACEHOLDER,
        jwt_secret=_PLACEHOLDER_SECRET,
        edge_signing_secret=_PLACEHOLDER_SECRET,
        edge_service_key=_PLACEHOLDER_SECRET,
    )


def build_schema() -> dict[str, Any]:
    """构造应用并取它的 OpenAPI 文档。"""
    return build_app(_export_settings()).openapi()


def render(schema: dict[str, Any]) -> str:
    """序列化成稳定文本：键排序 + 固定缩进，diff 才有意义。"""
    body = json.dumps(schema, ensure_ascii=False, indent=2, sort_keys=True)
    return f"{body}\n"


def main() -> None:
    """写文件；带 `--check` 时只比对不写，不一致以非零码退出。"""
    text = render(build_schema())
    if "--check" in sys.argv:
        current = OUTPUT.read_text(encoding="utf-8") if OUTPUT.exists() else ""
        if current != text:
            sys.stderr.write(
                "openapi.json 与代码不一致，"
                "请运行 uv run python -m scripts.export_openapi 后提交\n"
            )
            raise SystemExit(1)
        sys.stdout.write("openapi.json 一致\n")
        return
    OUTPUT.write_text(text, encoding="utf-8")
    sys.stdout.write(f"已写出 {OUTPUT}\n")


if __name__ == "__main__":
    main()
