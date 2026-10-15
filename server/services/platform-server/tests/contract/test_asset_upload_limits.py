"""素材直传的网关请求上限须容纳模型文件与 multipart 表单开销。"""

import re
from pathlib import Path

import pytest

from platform_server.apps.assets.kinds import spec_of

ROOT = Path(__file__).resolve().parents[5]


@pytest.mark.parametrize(
    "filename", ["nginx.conf.template", "dt-edge.windows.conf"]
)
def test_the_gateway_accepts_the_largest_model_and_form_fields(
    filename: str,
) -> None:
    source = (ROOT / "docker" / "nginx" / filename).read_text(encoding="utf-8")
    location = re.search(
        r"location \^~ /oss/ \{(?P<body>.*?)^\s*\}",
        source,
        re.DOTALL | re.MULTILINE,
    )
    assert location is not None
    body = location.group("body")
    ceiling = re.search(r"client_max_body_size\s+(\d+)([kmg]);", body)
    assert ceiling is not None
    scale = {"k": 1024, "m": 1024**2, "g": 1024**3}
    max_bytes = int(ceiling.group(1)) * scale[ceiling.group(2)]
    spec = spec_of("model")
    assert spec is not None
    assert max_bytes >= 2_148_532_224
    assert max_bytes > spec.max_bytes
    assert "proxy_request_buffering off;" in body
