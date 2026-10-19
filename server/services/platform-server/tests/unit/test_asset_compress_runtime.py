"""模型压缩程序在源码、镜像和 Windows 服务环境中的路径契约。"""

import sys
from pathlib import Path

import pytest

from platform_server.apps.assets.services import compress_runtime


def test_explicit_paths_support_spaces_and_non_ascii(tmp_path: Path) -> None:
    script = tmp_path / "模型 tools" / "compress-model.mjs"
    script.parent.mkdir()
    script.touch()

    runtime = compress_runtime.resolve_compressor(
        node=sys.executable, script=str(script)
    )

    assert Path(runtime.node) == Path(sys.executable).resolve()
    assert runtime.script == script.resolve()


@pytest.mark.parametrize("node", ["node", "node.exe"])
def test_windows_service_finds_node_without_login_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, node: str
) -> None:
    program_files = tmp_path / "Program Files"
    executable = program_files / "nodejs" / "node.exe"
    executable.parent.mkdir(parents=True)
    executable.touch(mode=0o755)
    script = tmp_path / "compress-model.mjs"
    script.touch()
    monkeypatch.setenv("PATH", "")
    monkeypatch.setenv("ProgramW6432", str(tmp_path / "missing-install"))
    monkeypatch.delenv("ProgramFiles(x86)", raising=False)
    monkeypatch.setenv("ProgramFiles", str(program_files))
    monkeypatch.setattr(compress_runtime.platform, "system", lambda: "Windows")

    runtime = compress_runtime.resolve_compressor(node=node, script=str(script))

    assert Path(runtime.node) == executable.resolve()


def test_explicit_missing_node_does_not_silently_select_another_install(
    tmp_path: Path,
) -> None:
    with pytest.raises(RuntimeError, match="PLATFORM_ASSETCOMPRESS_NODE"):
        compress_runtime.resolve_compressor(
            node=str(tmp_path / "missing-node.exe"), script="auto"
        )


def test_missing_script_identifies_its_config_key(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="PLATFORM_ASSETCOMPRESS_SCRIPT"):
        compress_runtime.resolve_compressor(
            node=sys.executable, script=str(tmp_path / "missing.mjs")
        )


def test_auto_script_follows_source_installation_instead_of_working_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = tmp_path / "模型服务"
    module = (
        service / "src/platform_server/apps/assets/services/compress_runtime.py"
    )
    script = service / "nodetools/compress-model.mjs"
    script.parent.mkdir(parents=True)
    script.touch()
    monkeypatch.setattr(compress_runtime, "__file__", str(module))
    monkeypatch.chdir(tmp_path)

    runtime = compress_runtime.resolve_compressor(
        node=sys.executable, script="auto"
    )

    assert runtime.script == script.resolve()


def test_auto_script_supports_container_layout(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    module = (
        tmp_path
        / "venv/lib/python/site-packages/platform_server"
        / "apps/assets/services/compress_runtime.py"
    )
    script = tmp_path / "app/nodetools/compress-model.mjs"
    script.parent.mkdir(parents=True)
    script.touch()
    monkeypatch.setattr(compress_runtime, "__file__", str(module))
    monkeypatch.setattr(compress_runtime, "CONTAINER_SCRIPT", script)

    runtime = compress_runtime.resolve_compressor(
        node=sys.executable, script="auto"
    )

    assert runtime.script == script.resolve()


def test_node_name_uses_the_service_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    executable = Path(sys.executable)
    script = tmp_path / "compress-model.mjs"
    script.touch()
    monkeypatch.setenv("PATH", str(executable.parent))

    runtime = compress_runtime.resolve_compressor(
        node=executable.name, script=str(script)
    )

    assert Path(runtime.node) == executable.resolve()


def test_windows_missing_installation_reports_nssm_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("PATH", "")
    for name in ("ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(compress_runtime.platform, "system", lambda: "Windows")

    with pytest.raises(RuntimeError, match="NSSM"):
        compress_runtime.resolve_compressor(node="node", script="auto")


def test_non_windows_does_not_search_windows_installations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("PATH", "")
    monkeypatch.setattr(compress_runtime.platform, "system", lambda: "Linux")

    with pytest.raises(RuntimeError, match="PLATFORM_ASSETCOMPRESS_NODE"):
        compress_runtime.resolve_compressor(node="node", script="auto")
