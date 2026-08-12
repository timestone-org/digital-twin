"""表格行的字段集必须与指标目录逐一对应，错误码必须与设计文档一致。

⚠ 目录是外部视图形状的唯一真源，而对外模型的字段是手写的。两边漂移不会报错，
只会让某个指标在表格里永远为空——这份文件就是把两者钉在一起的那颗钉子。
"""

from platform_server.apps.hvac import errors
from platform_server.apps.hvac.datasets import (
    DATASET_RAW_MINUTE,
    find_dataset,
    metric_keys,
)
from platform_server.apps.hvac.schemas import RawSampleOut

# 设计文档 §7 登记的码，改一个都要先改这里
EXPECTED_CODES = {
    errors.DatasetNotFound: (41609, 404),
    errors.BindingNotFound: (41610, 404),
    errors.SourceObjectInvalid: (41611, 422),
    errors.SourceObjectShapeMismatch: (41612, 422),
    errors.TimeRangeInvalid: (41613, 422),
    errors.MetricUnknown: (41614, 422),
    errors.CursorInvalid: (41615, 422),
    errors.SourceUnavailable: (51601, 503),
}


def catalog_metrics() -> tuple[str, ...]:
    """目录里 raw_minute 的全部指标 key。"""
    dataset = find_dataset(DATASET_RAW_MINUTE)
    assert dataset is not None
    return metric_keys(dataset)


def test_the_sample_row_carries_exactly_the_catalog_metrics() -> None:
    fields = tuple(RawSampleOut.model_fields)
    assert fields[0] == "ts"
    assert fields[1:] == catalog_metrics()


def test_every_metric_field_accepts_a_null_reading() -> None:
    # ⚠ 19 列在外库里全部可空。把 NULL 折成 0 会把数据断档读成一次真实的停机
    keys = catalog_metrics()
    payload: dict[str, object] = {"ts": "2026-08-12T00:00:00Z"}
    payload.update(dict.fromkeys(keys))
    sample = RawSampleOut.model_validate(payload)
    assert [getattr(sample, key) for key in keys] == [None] * len(keys)


def test_each_error_code_matches_the_designed_number_and_status() -> None:
    actual = {item: (item.code, item.http_status) for item in EXPECTED_CODES}
    assert actual == EXPECTED_CODES


def test_the_unavailable_source_is_the_only_retryable_one() -> None:
    # 只有「下游暂时不可用」重试有意义；参数错重试多少次都还是参数错
    retryable = {item for item in EXPECTED_CODES if item.is_retryable}
    assert retryable == {errors.SourceUnavailable}
