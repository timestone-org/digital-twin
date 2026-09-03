"""那张凭据表这一期**只留声明、不再读写**（ADR-0041）。

扩展—收缩两次发布：代码可回滚、数据库不回滚，所以「新结构 + 旧代码」必须可用
——回滚到上一版的助手要仍旧读得到这张表。删表在下一次发布。

⚠ 这条用例守的是反过来那件事：**没有任何读写路径**。留一条的话，登录态就又有
了两个属主，而两个属主各刷各的令牌会互相把对方的作废。
"""

from pathlib import Path

import ai_assistant
from ai_assistant.apps.credential.models import ModelCredential


def test_the_table_is_still_declared_for_the_rollback_window() -> None:
    assert ModelCredential.__tablename__ == "model_credentials"


def test_nothing_in_this_service_reads_or_writes_it_any_more() -> None:
    """⚠ 按 import 数而不是按人记：漏一条的表现是「登录态有两个属主」，
    而那要等到两边同时续期、互相把令牌顶掉时才看得见。"""
    root = Path(ai_assistant.__file__).parent
    readers = [
        path.relative_to(root).as_posix()
        for path in root.rglob("*.py")
        if "apps/credential/" not in path.as_posix()
        and "apps.credential" in path.read_text(encoding="utf-8")
    ]
    assert readers == []
