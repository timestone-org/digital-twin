"""边缘网关配置里与鉴权、限流、素材面相关的几条硬约束。

⚠ nginx 的 `proxy_set_header` / `error_page` / `add_header` 都是「本层写了一条，
上层的就全部不继承」。server 级写着的那几条置空与错误页，在任何自己写了头的
location 里都静默失效，`nginx -t` 不会报任何东西，只能逐个 location 去数。
两份配置（容器模板与 Windows 那份）各数一遍，它们是同一口径的两个副本。
"""

import re
from dataclasses import dataclass
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[5]
CONFIGS = ("nginx.conf.template", "dt-edge.windows.conf")
AUTH_HEADERS = (
    "X-Auth-User-Id",
    "X-Auth-Username",
    "X-Auth-Role",
    "X-Auth-Permissions",
    "X-Auth-Permissions-Truncated",
    "X-Auth-Exp",
    "X-Auth-Sig",
)
# 引号串整体跳过：串里的 `#` 与花括号不是注释也不是块边界
_LEXEME = re.compile(r"'[^']*'|\"(?:\\.|[^\"\\])*\"|#[^\n]*|[{}]")


@dataclass(frozen=True)
class Block:
    """一个 `location` 块：匹配串与去掉注释后的块体。"""

    match: str
    body: str


def _strip_comments(source: str) -> str:
    return _LEXEME.sub(
        lambda found: "" if found.group().startswith("#") else found.group(),
        source,
    )


def _close_of(text: str, start: int) -> int:
    depth = 0
    for found in _LEXEME.finditer(text, start):
        if found.group() == "{":
            depth += 1
        elif found.group() == "}":
            depth -= 1
            if depth == 0:
                return found.start()
    raise AssertionError("花括号不配对")


def _server_body(text: str) -> str:
    found = re.search(r"\bserver\s*\{", text)
    assert found is not None
    return text[found.end() - 1 : _close_of(text, found.end() - 1) + 1]


def load(filename: str) -> tuple[str, list[Block]]:
    """读一份配置，给出 server 级指令（不含 location）与全部 location 块。

    Args: filename。
    """
    text = _strip_comments(
        (ROOT / "docker" / "nginx" / filename).read_text(encoding="utf-8")
    )
    server = _server_body(text)
    blocks: list[Block] = []
    outside: list[str] = []
    cursor = 1
    for found in re.finditer(r"\blocation\s+([^{]+?)\s*\{", server):
        if found.start() < cursor:
            continue
        end = _close_of(server, found.end() - 1)
        outside.append(server[cursor : found.start()])
        blocks.append(Block(found.group(1).strip(), server[found.end() : end]))
        cursor = end + 1
    outside.append(server[cursor:-1])
    return "".join(outside), blocks


def find(blocks: list[Block], match: str) -> Block:
    """按匹配串取一个 location。

    Args: blocks, match。
    """
    return next(block for block in blocks if block.match == match)


def _includes(body: str, name: str) -> bool:
    return (
        re.search(rf"\binclude\s+(?:\S*/)?{re.escape(name)}\s*;", body)
        is not None
    )


def _sets_header(body: str, header: str) -> bool:
    return re.search(rf"\bproxy_set_header\s+{header}\s", body) is not None


@pytest.mark.parametrize("filename", CONFIGS)
def test_every_rate_limit_rejects_with_429_not_503(filename: str) -> None:
    """limit_req 默认回 503：前端会把「点太快了」报成服务端故障。"""
    server, blocks = load(filename)
    server_wide = "limit_req_status 429;" in server
    limited = [block for block in blocks if "limit_req " in block.body]
    assert limited
    for block in limited:
        assert server_wide or "limit_req_status 429;" in block.body, block.match


@pytest.mark.parametrize("filename", CONFIGS)
def test_edge_rejections_carry_the_unified_envelope(filename: str) -> None:
    """边缘自己回的 429 也要是信封：不是信封的响应前端一律当成「格式异常」。"""
    server, blocks = load(filename)
    page = re.search(r"\berror_page\s+429\s+(@[\w-]+)\s*;", server)
    assert page is not None
    named = find(blocks, page.group(1))
    assert "default_type application/json;" in named.body
    assert '"code":40002' in named.body
    assert '"trace_id":"$request_id"' in named.body
    for block in blocks:
        if "limit_req " in block.body:
            assert "error_page" not in block.body, block.match


@pytest.mark.parametrize("filename", CONFIGS)
def test_client_sent_identity_headers_never_reach_an_upstream(
    filename: str,
) -> None:
    """location 里写了任何一条 proxy_set_header，server 级置空就不再生效。"""
    _, blocks = load(filename)
    for block in blocks:
        writes_headers = "proxy_set_header" in block.body or _includes(
            block.body, "proxy-common.conf"
        )
        if not writes_headers or _includes(block.body, "auth-inject.conf"):
            continue
        missing = [h for h in AUTH_HEADERS if not _sets_header(block.body, h)]
        assert not missing, (block.match, missing)


@pytest.mark.parametrize("filename", CONFIGS)
def test_asset_bytes_cannot_run_script_in_the_app_origin(filename: str) -> None:
    """素材与应用同源：一张带脚本的 SVG 被直接打开，就能读走本站的令牌。"""
    _, blocks = load(filename)
    body = find(blocks, "^~ /oss/").body
    policy = re.search(
        r"add_header\s+Content-Security-Policy\s+\"([^\"]+)\"\s+always;", body
    )
    assert policy is not None
    directives = {item.strip() for item in policy.group(1).split(";")}
    assert "sandbox" in directives
    assert "default-src 'none'" in directives


@pytest.mark.parametrize("filename", CONFIGS)
def test_asset_errors_do_not_leak_the_bucket(filename: str) -> None:
    """对象存储的错误体里带桶名与对象键；对外地址刻意不暴露桶名。"""
    _, blocks = load(filename)
    body = find(blocks, "^~ /oss/").body
    assert "proxy_intercept_errors on;" in body
    for status in ("403", "404"):
        page = re.search(rf"\berror_page\s+{status}\s+(@[\w-]+)\s*;", body)
        assert page is not None, status
        named = find(blocks, page.group(1))
        assert "proxy_pass" not in named.body


@pytest.mark.parametrize("filename", CONFIGS)
def test_asset_bytes_have_an_explicit_short_cache_lifetime(
    filename: str,
) -> None:
    """不给 Cache-Control 时浏览器按启发式缓存，删掉的图要很多天才消失。"""
    _, blocks = load(filename)
    body = find(blocks, "^~ /oss/").body
    lifetime = re.search(
        r"add_header\s+Cache-Control\s+\"[^\"]*max-age=(\d+)[^\"]*\"\s*;", body
    )
    assert lifetime is not None
    assert int(lifetime.group(1)) <= 3600
