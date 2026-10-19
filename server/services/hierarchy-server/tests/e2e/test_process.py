"""真实服务进程重启后仍能读取已保存项目。"""

import asyncio
import json
import os
import socket
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from conftest import headers

from hierarchy_server.settings import Settings

ENTRY = (
    "import sys, uvicorn; "
    "from hierarchy_server.app import build_app; "
    "from hierarchy_server.settings import Settings; "
    "uvicorn.run(build_app(Settings()), fd=int(sys.argv[1]), "
    "log_config=None, access_log=False)"
)


def environment(settings: Settings) -> dict[str, str]:
    result = {
        name: os.environ[name] for name in ("PATH",) if name in os.environ
    }
    values = settings.model_dump(mode="json")
    values["postgres_password"] = settings.postgres_password.get_secret_value()
    values["edge_signing_secret"] = (
        settings.edge_signing_secret.get_secret_value()
    )
    values["edge_service_key"] = settings.edge_service_key.get_secret_value()
    for name, value in values.items():
        if value is not None:
            result[f"HIERARCHY_{name.upper()}"] = str(value)
    return result


async def started(process: asyncio.subprocess.Process) -> None:
    if process.stdout is None:
        raise RuntimeError("测试进程未提供启动输出")
    async with asyncio.timeout(15):
        while line := await process.stdout.readline():
            event = json.loads(line)
            if event.get("event") == "component_started":
                return
    raise RuntimeError("服务没有完成启动")


@asynccontextmanager
async def running(settings: Settings) -> AsyncIterator[httpx.AsyncClient]:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen()
        port = listener.getsockname()[1]
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-c",
            ENTRY,
            str(listener.fileno()),
            pass_fds=(listener.fileno(),),
            env=environment(settings),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            await started(process)
            async with httpx.AsyncClient(
                base_url=f"http://127.0.0.1:{port}",
                headers=headers(),
                timeout=10,
            ) as client:
                yield client
        finally:
            process.terminate()
            await asyncio.wait_for(process.wait(), timeout=10)


async def test_process_restart_preserves_saved_revision(settings, document):
    async with running(settings) as client:
        created = await client.post(
            "/api/v1/hierarchy/projects",
            json={"document": document.model_dump(by_alias=True)},
        )
        assert created.status_code == 201
        project = created.json()["data"]
        path = f"/api/v1/hierarchy/projects/{project['id']}"
        project["document"]["nodes"][0]["parameter"] = "0.5级"
        saved = await client.put(
            path, json={"revision": 1, "document": project["document"]}
        )
        assert saved.status_code == 200
    async with running(settings) as restarted:
        reloaded = await restarted.get(path)
        assert reloaded.status_code == 200
        assert reloaded.json()["data"]["revision"] == 2
        assert (
            reloaded.json()["data"]["document"]["nodes"][0]["parameter"]
            == "0.5级"
        )
        assert (await restarted.delete(path)).status_code == 204
