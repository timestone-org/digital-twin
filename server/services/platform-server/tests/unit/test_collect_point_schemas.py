"""采集点位编码保留现场符号，同时拒绝破坏稳定身份的输入。"""

import pytest
from pydantic import ValidationError

from platform_server.apps.collect.schemas.point import PointItemIn
from platform_server.apps.collect.schemas.source import SourceCreateIn


@pytest.mark.parametrize(
    "code",
    [
        "RS_HYGS_DLZX_1#PRESSUREPUMP_FREQ",
        "ns=2;s=RS_HYGS_DLZX_1#PRESSUREPUMP_FREQ",
        "#PRESSUREPUMP",
        'channel/pump[1]@freq+$%&!"()*,<>?\\^`{|}~',
        "x" * 64,
    ],
    ids=["plc-symbol", "node-id", "leading-symbol", "punctuation", "maximum"],
)
def test_point_codes_preserve_visible_ascii_symbols(code: str) -> None:
    point = PointItemIn(code=code, name="压力泵频率", address="ns=2;s=pump")
    assert point.code == code


@pytest.mark.parametrize(
    "code",
    [
        "",
        " \t\n",
        "x" * 65,
        "pump:freq",
        "pump freq",
        "pump\t1",
        "pump\n1",
        "pump\0",
        "pump\x7f",
        "泵频率",
    ],
    ids=[
        "empty",
        "blank",
        "too-long",
        "identity-separator",
        "space",
        "tab",
        "newline",
        "nul",
        "del",
        "unicode",
    ],
)
def test_point_codes_reject_invalid_identity_characters(code: str) -> None:
    with pytest.raises(ValidationError):
        PointItemIn(code=code, name="压力泵频率", address="ns=2;s=pump")


def test_point_codes_trim_outer_whitespace_without_rewriting_symbols() -> None:
    point = PointItemIn(
        code="  RS_HYGS_DLZX_1#PRESSUREPUMP_FREQ  ",
        name="压力泵频率",
        address="ns=2;s=pump",
    )
    assert point.code == "RS_HYGS_DLZX_1#PRESSUREPUMP_FREQ"


@pytest.mark.parametrize("code", ["line-1", "A_B.1"])
def test_source_codes_keep_accepting_ascii_identifiers(code: str) -> None:
    source = SourceCreateIn(
        code=code, name="产线", protocol="opcua", endpoint="opc.tcp://test:4840"
    )
    assert source.code == code


@pytest.mark.parametrize("code", ["line#1", "ns=2;s=pump", "#line"])
def test_source_codes_still_reject_point_symbols(code: str) -> None:
    with pytest.raises(ValidationError):
        SourceCreateIn(
            code=code,
            name="产线",
            protocol="opcua",
            endpoint="opc.tcp://test:4840",
        )
