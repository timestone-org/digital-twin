"""规则运行使用独立流，旧worker不能竞争领取规则任务。"""

from lib.stream import StreamGroup
from platform_server.apps.modeling.services.run_queue import rules_target


def test_rule_target_preserves_consumer_and_isolates_stream_and_group() -> None:
    trained = StreamGroup(
        stream="platform:modeling:run", group="modeling-runners", consumer="api"
    )
    rule = rules_target(trained)
    assert rule.stream == "platform:modeling:run:rules"
    assert rule.group == "modeling-runners:rules"
    assert rule.consumer == trained.consumer
    assert trained.stream == "platform:modeling:run"
    assert trained.group == "modeling-runners"
