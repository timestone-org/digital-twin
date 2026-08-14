"""锁住 node_key 的组合与拆分互逆——包括 point_code 自身含冒号的那一类。"""

import uuid

import pytest

from timeseries.node_key import compose_node_key, split_node_key

SOURCE_ID = uuid.UUID("0198f2c0-8e00-7a1e-9c3b-2d4f6a8b0c1e")


@pytest.mark.parametrize(
    "point_code",
    [
        "outlet_temp",
        "ns=2;s=Temp1",
        "holding:40001",
        "plant/line1:unit2:temp",
        "出口温度",
        "a",
        ":",
        "trailing:",
    ],
    ids=[
        "普通编码",
        "分号",
        "含一个冒号",
        "含多个冒号",
        "中文",
        "单字符",
        "只有冒号",
        "冒号结尾",
    ],
)
def test_split_undoes_compose_for_any_point_code(point_code: str) -> None:
    composed = compose_node_key(SOURCE_ID, point_code)
    assert split_node_key(composed) == (SOURCE_ID, point_code)


def test_compose_undoes_split_for_a_canonical_key() -> None:
    node_key = "0198f2c0-8e00-7a1e-9c3b-2d4f6a8b0c1e:holding:40001"
    source_id, point_code = split_node_key(node_key)
    assert compose_node_key(source_id, point_code) == node_key
