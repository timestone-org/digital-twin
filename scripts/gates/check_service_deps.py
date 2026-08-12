#!/usr/bin/env python3
"""服务依赖自洽闸：每个服务按**自己声明的依赖**装一遍，再把它的模块全部 import。

⚠ 这道闸补的是一个在单仓里永远看不见的洞：开发与测试跑在 workspace 的**共享
venv** 里，一个服务可以用上另一个服务装进来的包而毫无察觉——`import` 成功、
类型检查通过、全部用例绿。只有按自己声明的依赖独立安装的生产镜像会崩。

真实案例：`opcua-server` 声明 `lib[db,redis,web]` 漏了 `auth`，而它的 deps 要
`lib.auth`（内部 `import jwt`）。385 条用例与 16 项闸门全绿，容器起来即
`ModuleNotFoundError: No module named 'jwt'`，无限重启。

做法是复现生产条件而不是猜：`uv export --package <svc>` 拿到该服务的依赖闭包，
装进一个全新的空 venv，然后 `walk_packages` 把服务包下每个模块都 import 一遍。
不做「import 名 → 分发名」的映射猜测——那种映射（jwt←pyjwt、yaml←PyYAML）
既要人工维护，又会在条件导入上漏判。
"""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

from _report import GateError, Violation, main, service_dirs

SERVER = Path(__file__).resolve().parents[2] / "server"
# 装依赖要下载，比纯静态闸慢一档；超时按基础设施故障处理，不算服务的违规
INSTALL_TIMEOUT_S = 600
IMPORT_TIMEOUT_S = 120

# 把服务包下的每个模块都 import 一遍。仓规禁止 import 副作用与模块级可变状态
# （check_python_runtime 守着），所以整包遍历是安全的；若某个模块因副作用而
# 炸，那本身就是一条要修的违规。
_IMPORT_ALL = """
import importlib, pkgutil, sys
package = importlib.import_module({package!r})
failed = []
for info in pkgutil.walk_packages(package.__path__, package.__name__ + "."):
    try:
        importlib.import_module(info.name)
    except Exception as error:
        failed.append(f"{{info.name}}: {{type(error).__name__}}: {{error}}")
if failed:
    sys.stderr.write("\\n".join(failed))
    raise SystemExit(1)
"""


def _probe(*args: str, timeout_s: int) -> tuple[int, str]:
    """在 `server/` 下跑一条命令，返回（退出码, 标准错误+标准输出）。

    ⚠ 两处不能省：`NO_COLOR` 让 uv 不吐 ANSI 转义——否则导出的 requirements
    首行就解析不了；`cwd` 必须是 server/——导出里的 `-e ./lib` 是相对路径，
    换个目录装就找不到工作区成员。
    超时与找不到程序按基础设施故障抛，那不是服务的违规。

    Args: *args, timeout_s。
    """
    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=timeout_s,
            check=False,
            cwd=SERVER,
            env={**os.environ, "NO_COLOR": "1"},
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise GateError(f"{' '.join(args[:2])} 无法完成：{error}") from error
    return result.returncode, (result.stderr or result.stdout).strip()


def _must(*args: str, timeout_s: int, doing: str) -> str:
    """跑一条**必须成功**的命令，返回标准输出；失败即抛。

    ⚠ 与 `_probe` 分成两个函数是有意的：闸门自己的规矩是「跑了外部命令就
    必须查退出码」，而一个「返回结果、让调用方各自判」的包装器只要有一处
    调用方忘了判就静默。这里把「必须成功」与「要看失败内容」分开表达，
    两条路径各自都在函数内查了码。

    Args: *args, timeout_s, doing。
    """
    code, output = _probe(*args, timeout_s=timeout_s)
    if code != 0:
        raise GateError(f"{doing}失败：{output[:300]}")
    return output


def _packages_of(service: Path) -> list[str]:
    """服务 `src/` 下的顶层包名。没有 src 的（只有文档与依赖层）返回空。

    Args: service。
    """
    src = service / "src"
    if not src.is_dir():
        return []
    return sorted(
        path.name
        for path in src.iterdir()
        if path.is_dir() and not path.name.startswith("_")
    )


def _install_isolated(service_name: str, venv: Path) -> None:
    """把该服务的依赖闭包装进一个空 venv。

    Args: service_name, venv。
    """
    _must("uv", "venv", str(venv), timeout_s=INSTALL_TIMEOUT_S, doing="建 venv")
    exported = _must(
        "uv",
        "export",
        "--package",
        service_name,
        "--frozen",
        "--no-dev",
        "--format",
        "requirements-txt",
        timeout_s=INSTALL_TIMEOUT_S,
        doing=f"导出 {service_name} 的依赖",
    )
    requirements = venv.parent / f"{service_name}.txt"
    requirements.write_text(exported, encoding="utf-8")
    _must(
        "uv",
        "pip",
        "install",
        "--python",
        str(venv / "bin" / "python"),
        "--requirement",
        str(requirements),
        "--quiet",
        timeout_s=INSTALL_TIMEOUT_S,
        doing=f"按 {service_name} 的声明安装",
    )


def check_services_declare_what_they_import() -> list[Violation]:
    """每个服务按自己声明的依赖装完之后，它的模块必须全部 import 得动。"""
    found: list[Violation] = []
    for service in service_dirs():
        packages = _packages_of(service)
        if not packages:
            continue
        with tempfile.TemporaryDirectory() as workspace:
            venv = Path(workspace) / "venv"
            _install_isolated(service.name, venv)
            python = venv / "bin" / "python"
            for package in packages:
                code, output = _probe(
                    str(python),
                    "-c",
                    _IMPORT_ALL.format(package=package),
                    timeout_s=IMPORT_TIMEOUT_S,
                )
                if code == 0:
                    continue
                found.append(
                    Violation(
                        "服务用了自己没声明的依赖",
                        f"{service.name}/{package}",
                        output.splitlines()[0][:160],
                    )
                )
    return found


CHECKS = (check_services_declare_what_they_import,)


if __name__ == "__main__":
    raise SystemExit(main("服务依赖自洽检查", CHECKS))
