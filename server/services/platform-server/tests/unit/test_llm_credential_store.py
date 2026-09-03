"""登录态那一层里不碰库的几条。

守的是「一路供应商只许有一行」与「账号标识只留尾巴」——两条都是出了事才看得见
的：两行表现为「换了账号却没生效」，账号全量回给前端则是白白多摊了一份 PII。
"""

from platform_server.apps.llm_providers.models import LlmProviderCredential
from platform_server.apps.llm_providers.services.credential_store import (
    masked,
)


def test_a_credential_row_belongs_to_one_provider_only() -> None:
    # 同一路两行的话，读到哪一行取决于排序，而「换了账号却没生效」最难查
    unique = {
        column.name
        for constraint in LlmProviderCredential.__table__.constraints
        for column in getattr(constraint, "columns", [])
        if constraint.__class__.__name__ == "UniqueConstraint"
    }
    assert "provider_id" in unique


def test_the_login_dies_with_the_provider_row() -> None:
    # 留着的话，下一个建出来的供应商可能撞上一行没人认领的登录态
    rules = {
        key.ondelete
        for key in LlmProviderCredential.__table__.foreign_key_constraints
    }
    assert rules == {"CASCADE"}


def test_an_account_label_keeps_only_its_tail() -> None:
    assert masked("acct_1234567890") == "…567890"
    # 本来就短的话不必再截，截了反而看不出是哪个号
    assert masked("abc") == "abc"
    assert masked(None) is None
    assert masked("") is None
