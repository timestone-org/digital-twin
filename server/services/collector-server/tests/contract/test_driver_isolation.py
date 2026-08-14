"""守「协议知识不外泄」这条唯一可机器执行的表述。

⚠ `asyncua` 一旦出现在 `drivers/opcua/` 之外，管道层就开始拿 NodeId 与
StatusCode 说话，而那正是 ADR-0011 要防的事——它不会报错，只会让第二个协议
进来时无处下手。
"""

import ast
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parents[2] / "src" / "collector_server"
DRIVER_DIR = SOURCE_ROOT / "apps" / "collect" / "drivers" / "opcua"
PROTOCOL_PACKAGES = ("asyncua",)


def _imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
    return names


def _offenders() -> list[str]:
    return [
        f"{path.name}:{module}"
        for path in sorted(SOURCE_ROOT.rglob("*.py"))
        if DRIVER_DIR not in path.parents
        for module in _imports(path)
        if module.split(".")[0] in PROTOCOL_PACKAGES
    ]


def test_protocol_library_stays_inside_its_driver_directory() -> None:
    assert _offenders() == []


def test_the_driver_directory_is_where_the_protocol_lives() -> None:
    inside = {
        module
        for path in sorted(DRIVER_DIR.rglob("*.py"))
        for module in _imports(path)
        if module.split(".")[0] in PROTOCOL_PACKAGES
    }
    assert inside
