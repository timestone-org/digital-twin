"""口令散列与校验（argon2id）。"""

from argon2 import PasswordHasher as Argon2Hasher
from argon2.exceptions import (
    InvalidHashError,
    VerificationError,
    VerifyMismatchError,
)


class PasswordHasher:
    """散列器。参数由构造时固定，升参后旧散列由 `needs_rehash` 识别。"""

    def __init__(
        self,
        *,
        time_cost: int = 3,
        memory_cost_kib: int = 65536,
        parallelism: int = 4,
    ) -> None:
        self._hasher = Argon2Hasher(
            time_cost=time_cost,
            memory_cost=memory_cost_kib,
            parallelism=parallelism,
        )

    def hash(self, raw: str) -> str:
        """算一个 argon2id 散列。

        Args: raw。
        """
        return self._hasher.hash(raw)

    def verify(self, raw: str, hashed: str) -> bool:
        """校验口令；任何不匹配或散列损坏一律返回 False。

        Args: raw, hashed。
        """
        try:
            return self._hasher.verify(hashed, raw)
        except (
            VerifyMismatchError,
            VerificationError,
            InvalidHashError,
        ):
            return False

    def needs_rehash(self, hashed: str) -> bool:
        """散列是否用的是旧参数，需要在下次登录成功后重算。

        Args: hashed。
        """
        try:
            return self._hasher.check_needs_rehash(hashed)
        except InvalidHashError:
            return True
