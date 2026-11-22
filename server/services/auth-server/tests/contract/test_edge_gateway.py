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

from lib.auth import IDENTITY_HEADERS

ROOT = Path(__file__).resolve().parents[5]
CONFIGS = ("nginx.conf.template", "dt-edge.windows.conf")
# 引号串整体跳过：串里的 `#` 与花括号不是注释也不是块边界
_LEXEME = re.compile(r"'[^']*'|\"(?:\\.|[^\"\\])*\"|#[^\n]*|[{}]")

# 正则 location 的引号内可有重复次数 {8,64}。
_LOCATION = re.compile(
    r"""\blocation\s+((?:"(?:\\.|[^"\\])*"|'[^']*'|[^{}"'])+?)\s*\{"""
)


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
    for found in _LOCATION.finditer(server):
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


def test_docker_auth_audit_source_is_set_by_the_edge() -> None:
    server, blocks = load("nginx.conf.template")
    auth = find(blocks, "/api/v1/auth/")
    assert _includes(auth.body, "auth-inject.conf")
    assert "proxy_set_header X-Edge-Source-IP $remote_addr;" in auth.body
    assert 'proxy_set_header X-Edge-Audit-Key "${AUTH_EDGE_SERVICE_KEY}";' in (
        auth.body
    )
    assert not _sets_header(server, "X-Edge-Audit-Key")
    assert all(
        not _sets_header(block.body, "X-Edge-Audit-Key")
        for block in blocks
        if block is not auth
    )


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
        missing = [
            h for h in IDENTITY_HEADERS if not _sets_header(block.body, h)
        ]
        assert not missing, (block.match, missing)


@pytest.mark.parametrize("filename", CONFIGS)
def test_protected_routes_forward_the_signed_account_name(
    filename: str,
) -> None:
    _, blocks = load(filename)
    shared = (ROOT / "docker/nginx/auth-inject.conf").read_text()
    protected = [
        shared,
        *(
            block.body
            for block in blocks
            if re.search(r"\bauth_request\s+/_auth(?:_ws)?;", block.body)
        ),
    ]
    for body in protected:
        source = re.search(
            r"auth_request_set\s+(\$\w+)\s+\$upstream_http_x_auth_sig_v2;", body
        )
        assert source is not None
        assert re.search(
            rf"proxy_set_header\s+X-Auth-Sig-V2\s+{re.escape(source.group(1))};",
            body,
        )


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
def test_asset_and_error_responses_disable_mime_sniffing(filename: str) -> None:
    _, blocks = load(filename)
    assert "proxy_hide_header X-Content-Type-Options;" in (
        find(blocks, "^~ /oss/").body
    )
    for route in ("^~ /oss/", "@dt_oss_denied", "@dt_oss_missing"):
        assert (
            "add_header X-Content-Type-Options nosniff always;"
            in find(blocks, route).body
        ), route


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
        assert "types { }" in named.body
        assert "default_type text/plain;" in named.body


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


@pytest.mark.parametrize("filename", CONFIGS)
def test_immutable_font_responses_are_limited_to_hashed_build_artifacts(
    filename: str,
) -> None:
    """两种部署的一致缓存和协商范围。Args: filename。"""
    _, blocks = load(filename)
    fonts = [block for block in blocks if "gzip_static on;" in block.body]
    assert len(fonts) == 1
    font = fonts[0]
    expression = re.fullmatch(r'~\s+"([^"]+)"', font.match)
    assert expression is not None
    route = re.compile(expression[1])
    assert route.fullmatch("/ai/assets/HarmonyOS_Sans_SC_Regular-BuIQe7DE.ttf")
    assert route.fullmatch("/ai/assets/DS-DIGI-dG6DdXEc.TTF")
    for path in (
        "/ai/assets/System.ttf",
        "/ai/assets",
        "/ai/login",
        "/oss/logo.ttf",
    ):
        assert not route.fullmatch(path)
    assert "try_files $uri =404;" in font.body
    assert "gzip_vary on;" in font.body
    assert "default_type font/ttf;" in font.body
    assert (
        "add_header Cache-Control $dt_font_cache_control always;" in font.body
    )
    text = (ROOT / "docker" / "nginx" / filename).read_text(encoding="utf-8")
    assert re.search(
        r'map\s+"\$dt_embed_mode:\$status"\s+\$dt_font_cache_control\s*\{\s*'
        r"default\s+\$dt_embed_cache_control;\s*"
        r'"~\^0:\(200\|206\|304\)\$"\s+"public, max-age=31536000, immutable";',
        text,
    )
