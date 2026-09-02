"""凭据落库那一层里不碰库的几条。

守的是「配置漏填要在启动时炸」「一路模型只许有一行」「账号标识只留尾巴」——
三条都是出了事才看得见的：配漏了表现为「登录成功但令牌存不进去」，两行表现为
「换了账号却没生效」，账号全量回给前端则是白白多摊了一份 PII。
"""

import pytest
from pydantic import SecretStr

from ai_assistant.apps.credential.models import ModelCredential
from ai_assistant.apps.credential.services.store import masked
from ai_assistant.settings import Settings


def test_the_settings_refuse_to_start_without_a_secret() -> None:
    # 没配密钥就起来的话，表现是「登录成功了但令牌存不进去」
    with pytest.raises(ValueError, match="ASSISTANT_CREDENTIAL_SECRET"):
        Settings(
            postgres_host="x",
            postgres_user="x",
            postgres_password=SecretStr("x"),
            postgres_db="x",
            redis_host="x",
            edge_signing_secret=SecretStr("s" * 32),
            edge_service_key=SecretStr("k" * 32),
            codex_enabled=True,
            codex_model="some-model",
        )


def test_a_credential_row_belongs_to_one_provider_only() -> None:
    # 同一路两行的话，读到哪一行取决于排序，而「换了账号却没生效」最难查。
    # ⚠ 唯一的是**那一路供应商**（`provider_ref`）而不是种类：目录里能配出
    # 好几路订阅账号，种类那一格它们共用
    unique = {
        column.name
        for constraint in ModelCredential.__table__.constraints
        for column in getattr(constraint, "columns", [])
        if constraint.__class__.__name__ == "UniqueConstraint"
    }
    assert "provider_ref" in unique


def test_an_account_label_keeps_only_its_tail() -> None:
    assert masked("acct_1234567890") == "…567890"
    # 本来就短的话不必再截，截了反而看不出是哪个号
    assert masked("abc") == "abc"
    assert masked(None) is None
