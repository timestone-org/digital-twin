"""探一次端点通不通：拿密钥打 `GET {base_url}/models`，把它自报的模型名带回来。

⚠ 只做 GET：探测不该在供应商那边留下任何一次计费调用。
⚠ 失败**不抛**，收成一句给人看的话：探测的结果本身就是要交给界面的东西，
而原因里不许带端点地址、密钥与上游返回的原文（api-contract §4.2）。
"""

from dataclasses import dataclass, field
from typing import Any, cast

import httpx

from lib.logging import get_logger

_logger = get_logger("platform.llm_providers.probe")

MODELS_PATH = "/models"
# 端点自报的清单最多带回多少条；界面拿它做一键登记，几百条也没人挑得过来
MAX_LISTED_MODELS = 200
HTTP_UNAUTHORIZED = 401
HTTP_FORBIDDEN = 403
HTTP_NOT_FOUND = 404


@dataclass(frozen=True)
class ProbeResult:
    """一次探测的结果。"""

    is_ok: bool
    message: str
    model_names: list[str] = field(default_factory=list[str])


async def probe_endpoint(
    *,
    base_url: str,
    api_key: str,
    timeout_s: float,
    transport: httpx.AsyncBaseTransport | None = None,
) -> ProbeResult:
    """打一次 `/models`。

    Args: base_url, api_key, timeout_s, transport（只给用例换传输层用）。
    """
    try:
        async with httpx.AsyncClient(
            timeout=timeout_s, transport=transport
        ) as client:
            response = await client.get(
                f"{base_url.rstrip('/')}{MODELS_PATH}",
                headers={"Authorization": f"Bearer {api_key}"},
            )
    except httpx.TimeoutException:
        return ProbeResult(is_ok=False, message="端点超时没有响应")
    except httpx.HTTPError as error:
        _logger.info(
            "llm_probe_unreachable",
            "模型端点连不上",
            error_type=type(error).__name__,
        )
        return ProbeResult(is_ok=False, message="端点连不上，检查地址与网络")
    return _read(response)


def _read(response: httpx.Response) -> ProbeResult:
    """把上游的应答收成一句话。

    Args: response。
    """
    status = response.status_code
    if status in (HTTP_UNAUTHORIZED, HTTP_FORBIDDEN):
        return ProbeResult(is_ok=False, message="端点拒绝了这把密钥")
    if status == HTTP_NOT_FOUND:
        return ProbeResult(
            is_ok=False, message="端点上没有 /models，地址多半少了版本段"
        )
    if status >= HTTP_UNAUTHORIZED:
        return ProbeResult(is_ok=False, message=f"端点回了 HTTP {status}")
    names = _model_names(response)
    if names is None:
        return ProbeResult(
            is_ok=False, message="端点通了，但 /models 的应答不是 OpenAI 口径"
        )
    return ProbeResult(
        is_ok=True,
        message=f"端点可用，自报 {len(names)} 个模型",
        model_names=names,
    )


def _model_names(response: httpx.Response) -> list[str] | None:
    """从 `/models` 的应答里取模型代号；不成形给 `None`。

    Args: response。
    """
    try:
        body: object = response.json()
    except ValueError:
        return None
    if not isinstance(body, dict):
        return None
    rows = cast("dict[str, Any]", body).get("data")
    if not isinstance(rows, list):
        return None
    names: list[str] = []
    for row in cast("list[object]", rows):
        if not isinstance(row, dict):
            continue
        name = cast("dict[str, Any]", row).get("id")
        if isinstance(name, str) and name:
            names.append(name)
    return sorted(set(names))[:MAX_LISTED_MODELS]
