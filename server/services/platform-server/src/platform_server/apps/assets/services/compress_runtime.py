"""模型压缩的程序定位与部署路径校验，见 docs/DEPLOY_WINDOWS_NSSM.md。"""

import os
import platform
import shutil
from dataclasses import dataclass
from pathlib import Path

CONTAINER_SCRIPT = Path("/app/nodetools/compress-model.mjs")


@dataclass(frozen=True)
class CompressorRuntime:
    """经过校验的模型压缩程序路径。"""

    node: str
    script: Path


def resolve_compressor(*, node: str, script: str) -> CompressorRuntime:
    """解析可执行文件与脚本，不覆盖显式指定的无效路径。

    Args: node, script（auto 按源码或镜像布局定位）。
    """
    executable = _resolve_node(node)
    path = _default_script() if script == "auto" else Path(script).expanduser()
    if not path.is_file():
        raise RuntimeError(
            "找不到模型压缩脚本；请检查 PLATFORM_ASSETCOMPRESS_SCRIPT"
            f"（当前值：{script}，解析路径：{path}）。"
        )
    return CompressorRuntime(node=executable, script=path.resolve())


def _resolve_node(node: str) -> str:
    """按显式路径、进程 PATH、Windows 标准安装目录定位 Node。

    Args: node。
    """
    executable = shutil.which(node)
    if executable is None and node in {"node", "node.exe"}:
        executable = _windows_node()
    if executable is None:
        raise RuntimeError(
            "找不到 Node 可执行文件；请将 PLATFORM_ASSETCOMPRESS_NODE"
            f" 设置为 node.exe 的实际绝对路径（当前值：{node}）。"
            "NSSM 服务账户的 PATH 可能与登录用户不同；"
            "修改后重启 platform-worker。"
        )
    return str(Path(executable).resolve())


def _windows_node() -> str | None:
    if platform.system() != "Windows":
        return None
    for name in ("ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"):
        directory = os.environ.get(name)
        if directory:
            executable = shutil.which(str(Path(directory) / "nodejs/node.exe"))
            if executable is not None:
                return executable
    return None


def _default_script() -> Path:
    service = Path(__file__).resolve().parents[5]
    script = service / "nodetools/compress-model.mjs"
    return script if script.is_file() else CONTAINER_SCRIPT
