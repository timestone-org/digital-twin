"""锁住口令散列：不可逆、加盐、损坏散列不抛异常而是判否。"""

from lib.auth import PasswordHasher

# 单测里刻意用最弱参数，否则每条用例要跑几十毫秒
HASHER = PasswordHasher(time_cost=1, memory_cost_kib=8, parallelism=1)


def test_hash_never_contains_the_plaintext() -> None:
    hashed = HASHER.hash("correct horse battery")
    assert "correct horse battery" not in hashed


def test_same_password_hashes_differently_each_time() -> None:
    assert HASHER.hash("same-input-1") != HASHER.hash("same-input-1")


def test_verify_accepts_the_original_and_rejects_others() -> None:
    hashed = HASHER.hash("Passw0rd12")
    assert HASHER.verify("Passw0rd12", hashed)
    assert not HASHER.verify("Passw0rd13", hashed)
    assert not HASHER.verify("", hashed)


def test_corrupt_hash_is_rejected_without_raising() -> None:
    assert not HASHER.verify("anything", "not-a-hash")


def test_needs_rehash_flags_weaker_parameters() -> None:
    weak = PasswordHasher(time_cost=1, memory_cost_kib=8, parallelism=1)
    strong = PasswordHasher(time_cost=3, memory_cost_kib=64, parallelism=1)
    assert strong.needs_rehash(weak.hash("Passw0rd12"))
    assert not weak.needs_rehash(weak.hash("Passw0rd12"))


def test_needs_rehash_on_corrupt_hash_is_true() -> None:
    assert HASHER.needs_rehash("garbage")
