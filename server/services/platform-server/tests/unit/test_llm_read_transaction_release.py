"""登录与探测两条路在等上游之前放掉只读事务（database-standard §6）。

忘了放不报错：表现只是上游变慢时连接停在 idle in transaction，小连接池被耗尽。
"""

import uuid
from dataclasses import dataclass
from typing import Any, cast

import pytest

from lib.crypto import SecretCipher
from platform_server.apps.llm_providers import crud
from platform_server.apps.llm_providers.deps import get_login_provider
from platform_server.apps.llm_providers.enums import (
    PROVIDER_KIND_CODEX_OAUTH,
    PROVIDER_KIND_OPENAI_COMPAT,
)
from platform_server.apps.llm_providers.errors import (
    LlmProviderNotLoginBased,
)
from platform_server.apps.llm_providers.models import LlmProvider
from platform_server.apps.llm_providers.services import provider_service

PROVIDER = uuid.UUID("0192f0aa-0000-7000-8000-000000000004")
BASE_URL = "https://llm.example.test/v1"
CIPHER = SecretCipher("k" * 32, label="test")


@dataclass
class RecordingSession:
    """记下 rollback，并像真 session 那样让读过的行随之过期。"""

    row: LlmProvider
    rollbacks: int = 0

    async def rollback(self) -> None:
        self.rollbacks += 1
        self.row.base_url = None
        self.row.api_key_enc = None


def session_over(
    monkeypatch: pytest.MonkeyPatch, row: LlmProvider
) -> RecordingSession:
    async def found(_session: object, _provider_id: uuid.UUID) -> LlmProvider:
        return row

    monkeypatch.setattr(crud.provider, "get", found)
    return RecordingSession(row=row)


async def test_a_login_provider_check_lets_go_of_its_transaction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = session_over(
        monkeypatch, LlmProvider(kind=PROVIDER_KIND_CODEX_OAUTH)
    )

    resolved = await get_login_provider(PROVIDER, cast(Any, session))

    assert resolved == PROVIDER
    assert session.rollbacks == 1


async def test_a_rejected_login_provider_leaves_the_session_alone(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = session_over(
        monkeypatch, LlmProvider(kind=PROVIDER_KIND_OPENAI_COMPAT)
    )

    with pytest.raises(LlmProviderNotLoginBased):
        await get_login_provider(PROVIDER, cast(Any, session))

    assert session.rollbacks == 0


async def test_a_stored_key_is_read_out_before_the_transaction_ends(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    row = LlmProvider(
        base_url=BASE_URL, api_key_enc=CIPHER.encrypt("sk-stored")
    )
    session = session_over(monkeypatch, row)

    stored = await provider_service.stored_api_key(
        cast(Any, session), PROVIDER, cipher=CIPHER
    )

    # ⚠ 先放事务后取值的话，读到的是已过期的行
    assert stored == (BASE_URL, "sk-stored")
    assert session.rollbacks == 1
