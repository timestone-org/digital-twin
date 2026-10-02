"""守「协议知识不外泄」这条唯一可机器执行的表述。

⚠ `asyncua` 一旦出现在 `drivers/opcua/` 之外，管道层就开始拿 NodeId 与
StatusCode 说话，而那正是 ADR-0011 要防的事——它不会报错，只会让第二个协议
进来时无处下手。
"""

import ast
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parents[2] / "src" / "collector_server"
DRIVERS_ROOT = SOURCE_ROOT / "apps" / "collect" / "drivers"
PROTOCOL_PACKAGES = {
    "asyncua": DRIVERS_ROOT / "opcua",
    "pymodbus": DRIVERS_ROOT / "modbus_tcp",
}


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
        for module in _imports(path)
        if (root := module.split(".")[0]) in PROTOCOL_PACKAGES
        if PROTOCOL_PACKAGES[root] not in path.parents
    ]


def test_protocol_library_stays_inside_its_driver_directory() -> None:
    assert _offenders() == []


def test_the_driver_directory_is_where_the_protocol_lives() -> None:
    for package, driver_dir in PROTOCOL_PACKAGES.items():
        inside = {
            module
            for path in sorted(driver_dir.rglob("*.py"))
            for module in _imports(path)
            if module.split(".")[0] == package
        }
        assert inside
