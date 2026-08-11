"""锁住标识生成的两条契约：UUIDv7 按时间前缀有序、uuid5 内容寻址恒定。"""

import uuid

from lib.utils.ids import uuid5_of, uuid7

NAMESPACE = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")


def test_uuid7_declares_version_and_rfc4122_variant() -> None:
    value = uuid7()
    assert value.version == 7
    # RFC 4122 变体：最高两位是 10
    assert (value.int >> 62) & 0b11 == 0b10


def test_uuid7_carries_the_millisecond_timestamp_in_its_prefix() -> None:
    value = uuid7(now_ms=0x0123456789AB)
    assert value.int >> 80 == 0x0123456789AB


def test_uuid7_sorts_by_time_so_btree_inserts_append() -> None:
    earlier = uuid7(now_ms=1_700_000_000_000)
    later = uuid7(now_ms=1_700_000_001_000)
    assert earlier < later


def test_uuid7_is_random_within_the_same_millisecond() -> None:
    stamped = {uuid7(now_ms=1_700_000_000_000) for _ in range(64)}
    assert len(stamped) == 64


def test_uuid5_of_is_deterministic_so_reimport_is_idempotent() -> None:
    assert uuid5_of(NAMESPACE, "a", "b") == uuid5_of(NAMESPACE, "a", "b")


def test_uuid5_of_separates_parts_so_ab_c_differs_from_a_bc() -> None:
    # ⚠ 不加分隔符时 ("ab","c") 与 ("a","bc") 会撞成同一个 id，
    # 表现为两条不同的内容被当成同一行覆盖掉
    assert uuid5_of(NAMESPACE, "ab", "c") != uuid5_of(NAMESPACE, "a", "bc")


def test_uuid5_of_depends_on_the_namespace() -> None:
    other = uuid.UUID("6ba7b811-9dad-11d1-80b4-00c04fd430c8")
    assert uuid5_of(NAMESPACE, "x") != uuid5_of(other, "x")
