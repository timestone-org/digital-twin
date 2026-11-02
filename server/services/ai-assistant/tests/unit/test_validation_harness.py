"""隔离验收入口拒绝远程地址，并在失败与取消后清理合成会话。"""

import argparse
import asyncio
import importlib.util
import sys
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import cast
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

ROOT = Path(__file__).resolve().parents[5]
SESSION_ID = "00000000-0000-7000-8000-000000000001"
SESSIONS = "/api/v1/assistant/sessions"
INVALID_URLS = (
    "http://127.0.0.1:4141@outside.example/private?token=synthetic",
    "http://user:synthetic@127.0.0.1:4141",
    "http://@127.0.0.1:4141",
    "http://127.0.0.1",
    "http://127.0.0.1:",
    "http://127.0.0.1:0",
    "http://127.0.0.1:-1",
    "http://127.0.0.1:65536",
    "http://127.0.0.1:port",
    "https://127.0.0.1:4141",
    "http://127.0.0.1.example:4141",
    "http://[127.0.0.1:4141",
)


Arguments = Callable[[], argparse.Namespace]
Scenario = Callable[
    [httpx.AsyncClient, httpx.AsyncClient, async_sessionmaker[AsyncSession]],
    Awaitable[dict[str, object]],
]
ReceiptScenario = Callable[
    [httpx.AsyncClient, httpx.AsyncClient], Awaitable[dict[str, object]]
]


@dataclass(frozen=True)
class Verifier:
    """动态脚本边界只暴露本轮验证的入口。"""

    arguments: Arguments
    summary_case: Scenario
    overflow_case: Scenario
    receipt_case: ReceiptScenario


def _verifier(module: ModuleType) -> Verifier:
    """在动态加载边界收敛场景签名；Args: module。"""
    return Verifier(
        arguments=cast("Arguments", module._arguments),
        summary_case=cast("Scenario", module._summary_case),
        overflow_case=cast("Scenario", module._overflow_case),
        receipt_case=cast("ReceiptScenario", module._receipt_case),
    )


def _load(monkeypatch: pytest.MonkeyPatch, filename: str) -> ModuleType:
    """只加载仓内验收脚本，不运行入口；Args: monkeypatch, filename。"""
    path = ROOT / "postman/tests" / filename
    spec = importlib.util.spec_from_file_location(path.stem, path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, path.stem, module)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("url", INVALID_URLS)
def test_validation_factory_rejects_nonlocal_or_ambiguous_urls(
    monkeypatch: pytest.MonkeyPatch, url: str
) -> None:
    module = _load(monkeypatch, "assistant_context_app.py")
    settings = SimpleNamespace(
        postgres_host="127.0.0.1",
        postgres_db="dt_ai_validation",
        model_base_url=url,
    )
    monkeypatch.setattr(module, "load_settings", Mock(return_value=settings))
    builder = Mock(return_value=FastAPI())
    monkeypatch.setattr(module, "build_app", builder)
    factory = cast("Callable[[], FastAPI]", module.build_validation_app)

    with pytest.raises(RuntimeError) as caught:
        factory()

    assert url not in str(caught.value)
    builder.assert_not_called()


@pytest.mark.parametrize("argument", ["--assistant", "--provider"])
@pytest.mark.parametrize("url", INVALID_URLS)
def test_validation_cli_rejects_urls_without_echoing_them(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    argument: str,
    url: str,
) -> None:
    verifier = _verifier(_load(monkeypatch, "verify_assistant_context.py"))
    monkeypatch.setattr(sys, "argv", ["verify", argument, url])

    with pytest.raises(SystemExit) as caught:
        verifier.arguments()

    assert caught.value.code == 2
    assert url not in capsys.readouterr().err


@pytest.mark.parametrize(
    "url", ["http://127.0.0.1:1", "http://127.0.0.1:65535/model"]
)
def test_explicit_loopback_ports_remain_usable(
    monkeypatch: pytest.MonkeyPatch, url: str
) -> None:
    module = _load(monkeypatch, "assistant_context_app.py")
    settings = SimpleNamespace(
        postgres_host="127.0.0.1",
        postgres_db="dt_ai_validation",
        model_base_url=url,
    )
    monkeypatch.setattr(module, "load_settings", Mock(return_value=settings))
    app = FastAPI()
    monkeypatch.setattr(module, "build_app", Mock(return_value=app))
    factory = cast("Callable[[], FastAPI]", module.build_validation_app)
    assert factory() is app
    verifier = _verifier(_load(monkeypatch, "verify_assistant_context.py"))
    monkeypatch.setattr(
        sys, "argv", ["verify", "--assistant", url, "--provider", url]
    )
    args = verifier.arguments()
    assert args.assistant == args.provider == url


def _session_body() -> dict[str, object]:
    """提供真实新建会话契约所需的合成字段。"""
    return {
        "id": SESSION_ID,
        "user_id": SESSION_ID,
        "title": "验收",
        "surface_kind": "dashboard-editor",
        "surface_ref": None,
        "is_archived": False,
        "row_version": 1,
        "last_error": None,
        "created_at": "2026-11-02T00:00:00Z",
        "updated_at": "2026-11-02T00:00:00Z",
    }


def _transport(
    requests: list[tuple[str, str]], delete_status: int = 204
) -> httpx.MockTransport:
    """只接受创建、控制与精确删除；Args: requests, delete_status。"""

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append((request.method, request.url.path))
        if request.url.path == "/control":
            return httpx.Response(200)
        if request.method == "POST" and request.url.path == SESSIONS:
            return httpx.Response(201, json={"data": _session_body()})
        if (
            request.method == "DELETE"
            and request.url.path == f"{SESSIONS}/{SESSION_ID}"
        ):
            return httpx.Response(delete_status)
        raise AssertionError("验收脚本发出未预期请求")

    return httpx.MockTransport(handle)


async def _run_case(
    verifier: Verifier,
    scenario: str,
    client: httpx.AsyncClient,
    provider: httpx.AsyncClient,
) -> None:
    """从实际场景入口观察清理；Args: verifier, scenario, client, provider。"""
    maker = async_sessionmaker[AsyncSession]()
    if scenario == "receipt":
        await verifier.receipt_case(client, provider)
    elif scenario == "summary":
        await verifier.summary_case(client, provider, maker)
    else:
        await verifier.overflow_case(client, provider, maker)


@pytest.mark.parametrize("scenario", ["summary", "overflow", "receipt"])
@pytest.mark.parametrize("failure", [RuntimeError, asyncio.CancelledError])
async def test_failure_or_cancellation_deletes_the_created_session(
    monkeypatch: pytest.MonkeyPatch,
    scenario: str,
    failure: type[BaseException],
) -> None:
    module = _load(monkeypatch, "verify_assistant_context.py")
    monkeypatch.setattr(
        module, "_seed", AsyncMock(side_effect=failure("seed interrupted"))
    )
    monkeypatch.setattr(
        module, "_advance", AsyncMock(side_effect=failure("seed interrupted"))
    )
    requests: list[tuple[str, str]] = []
    transport = _transport(requests)
    async with (
        httpx.AsyncClient(
            transport=transport, base_url="http://assistant.invalid"
        ) as client,
        httpx.AsyncClient(
            transport=transport, base_url="http://provider.invalid"
        ) as provider,
    ):
        with pytest.raises(failure, match="seed interrupted"):
            await _run_case(_verifier(module), scenario, client, provider)
    assert requests[-1] == ("DELETE", f"{SESSIONS}/{SESSION_ID}")
    assert sum(method == "DELETE" for method, _ in requests) == 1


@pytest.mark.parametrize("scenario", ["summary", "overflow", "receipt"])
async def test_failed_cleanup_is_reported_once_without_retry(
    monkeypatch: pytest.MonkeyPatch,
    scenario: str,
) -> None:
    module = _load(monkeypatch, "verify_assistant_context.py")
    monkeypatch.setattr(module, "_seed", AsyncMock(return_value=[]))
    monkeypatch.setattr(
        module,
        "_advance",
        AsyncMock(side_effect=RuntimeError("advance interrupted")),
    )
    requests: list[tuple[str, str]] = []
    transport = _transport(requests, delete_status=500)
    async with (
        httpx.AsyncClient(
            transport=transport, base_url="http://assistant.invalid"
        ) as client,
        httpx.AsyncClient(
            transport=transport, base_url="http://provider.invalid"
        ) as provider,
    ):
        with pytest.raises(RuntimeError, match="清理"):
            await _run_case(_verifier(module), scenario, client, provider)
    assert sum(method == "DELETE" for method, _ in requests) == 1


OPTIMIZED_PROBE = """
import asyncio, importlib.util, sys
spec = importlib.util.spec_from_file_location(
    'optimized_validation', sys.argv[1])
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)
calls = []
def forbidden(*args, **kwargs):
    calls.append('io')
    raise RuntimeError('unexpected I/O')
module.httpx.AsyncClient = forbidden
module.create_async_engine = forbidden
try:
    asyncio.run(module.main())
except RuntimeError as error:
    if 'python -O' not in str(error):
        raise
else:
    raise RuntimeError('optimized harness did not reject execution')
if calls:
    raise RuntimeError('optimized harness attempted I/O')
from types import SimpleNamespace
deleted = []
class LocalClient:
    async def post(self, *args, **kwargs):
        return None
    async def delete(self, path):
        deleted.append(path)
        return SimpleNamespace(status_code=204)
async def new_session(*args):
    return 'synthetic-session'
async def interrupted(*args, **kwargs):
    raise RuntimeError('scenario interrupted')
module._new = new_session
module._seed = interrupted
module._advance = interrupted
async def verify_cleanup():
    client = LocalClient()
    scenarios = [(module._summary_case, (client, client, None)),
                 (module._overflow_case, (client, client, None)),
                 (module._receipt_case, (client, client))]
    for case, args in scenarios:
        try:
            await case(*args)
        except RuntimeError as error:
            if str(error) != 'scenario interrupted':
                raise
        else:
            raise RuntimeError('scenario failure was swallowed')
asyncio.run(verify_cleanup())
if deleted != ['/api/v1/assistant/sessions/synthetic-session'] * 3:
    raise RuntimeError('optimized cleanup did not execute exactly once')
print('blocked-before-http-and-db')
"""


async def test_optimized_main_blocks_io_and_cleanup_still_executes() -> None:
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-O",
        "-c",
        OPTIMIZED_PROBE,
        str(ROOT / "postman/tests/verify_assistant_context.py"),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=30)
    assert process.returncode == 0, stderr.decode()
    assert stdout.decode().strip() == "blocked-before-http-and-db"
