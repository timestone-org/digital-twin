"""权限码目录的只读视图，向 auth-server 取。

⚠ 取不到时**拒绝登记**（fail-closed），不是放行。理由见 CONTEXT.md §7：
登记是一次性动作，没有第二次校验的机会——放行一次，一个声明未经校验的主题
就永久留在库里；而拒绝的代价只是推送方重试一次，它本来就要按 at-least-once
处理注销，重试路径已经存在。
"""

import httpx
from pydantic import BaseModel, ValidationError

from lib.logging import get_logger
from realtime_hub.apps.channel.errors import CodeCatalogUnavailable

_logger = get_logger("realtime.catalog")

# auth-server 的内部端点。⚠ 服务级密钥走 X-Service-Key，与本服务自己的
# 内部端点用的是同一枚——集群内的服务级密钥全系统一份。
CODES_PATH = "/internal/v1/permission-codes"


class _CodesData(BaseModel):
    """信封里的 data 段。"""

    codes: list[str]


class _CodesEnvelope(BaseModel):
    """auth-server 的统一信封，本地只取 data。

    ⚠ 用模型收口而不是逐层下标：信封变形时要在这里响亮失败，而不是让一个
    空集合流下去——空集合会让**所有**登记都被判成「码不存在」。
    """

    data: _CodesData


class CodeCatalog:
    """auth-server 权限码目录的客户端。

    ⚠ 不做缓存：登记是低频动作（用户建一个实例才发生一次），而缓存会让
    「刚加的码还不认」变成一个要等 TTL 的谜题。真需要缓存时它属于 lib，
    不属于这里。
    """

    def __init__(
        self, *, base_url: str, service_key: str, timeout_s: float
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._service_key = service_key
        self._timeout_s = timeout_s
        # 传输层留成可替换的：用例要验的是解析与失败处置，不是 httpx 本身。
        # ⚠ 生产路径上它恒为 None，走 httpx 自己的默认传输。
        self._transport: httpx.AsyncBaseTransport | None = None
        self._http: httpx.AsyncClient | None = None

    async def known_codes(self) -> frozenset[str]:
        """取全部已登记的权限码。

        ⚠ 超时必须有且必须短：这条调用挂在登记请求的同步路径上，下游之和
        要小于上游（runtime-resilience.md），拖住它等于拖住推送方的建实例。
        ⚠ 只重试**这一层不做**：一条链路只有一层负责重试，重试归推送方。
        """
        try:
            client = self._client()
            response = await client.get(
                CODES_PATH, headers={"X-Service-Key": self._service_key}
            )
            response.raise_for_status()
            envelope = _CodesEnvelope.model_validate(response.json())
            return frozenset(envelope.data.codes)
        except (httpx.HTTPError, ValidationError, ValueError) as error:
            # ⚠ 不记异常里的响应体：它可能带着别的服务的内部信息
            _logger.error(
                "code_catalog_unreachable",
                "取权限码目录失败，登记将被拒绝",
                base_url=self._base_url,
                error_type=type(error).__name__,
            )
            raise CodeCatalogUnavailable(
                "无法校验权限码，请稍后重试"
            ) from error

    def _client(self) -> httpx.AsyncClient:
        """取那份长活的客户端；第一次要用时才建。

        ⚠ **一个进程一份，不是一次调用一份**：`httpx.AsyncClient` 自带连接池，
        每次调用现造一个再关掉，等于每次调用都重新握一次 TCP 手——而本客户端
        挂在推送方**每一次登记主题**的同步路径上。
        ⚠ 懒建而不是在 `__init__` 里建：装配跑在事件循环之外，而且传输层是
        构造之后才被替换的（用例注入假件那一步）。
        """
        if self._http is None:
            self._http = httpx.AsyncClient(
                base_url=self._base_url,
                timeout=self._timeout_s,
                transport=self._transport,
            )
        return self._http

    async def close(self) -> None:
        """关掉连接池。关停钩子里调，关完再用会现建一份新的。"""
        http, self._http = self._http, None
        if http is not None:
            await http.aclose()
