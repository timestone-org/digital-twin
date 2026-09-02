"""层 3 规划编排的扩展点：只有阈值，没有可替换的编排策略。

⚠ **这一层刻意不给「换一种编排」的口子。** 回合形态是单模型 + 计划工具，
不建 planner/executor 双层（ADR-0024）——留一个策略接口在这里，等于邀请下一个人
去实现那条已经被否决的路，而它与客户端驱动的回合边界正交性极差。

真要重开那条路时，改的是 ADR 与 `llmcore/turn/loop.py`，不是往这里插一个实现。
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class PlanPolicy:
    """计划纪律里那几个阈值。

    ⚠ 只能是**取值**不能是**行为**（config-and-secrets §6）：阈值可配，
    「要不要立计划」这件事本身不可配——按环境改行为会让两套部署跑出两种助手。
    """

    # 一份计划最多几项。再多的活该拆成几次对话，而不是一张读不完的清单
    max_items: int = 30
    max_item_title_chars: int = 200
    max_note_chars: int = 500
    # 模型停了嘴而计划没走完时，浏览器代用户催几次。⚠ 有上限：反复停下说明它
    # 自己也拿不准，那时该交还给人，不是继续催
    max_auto_continues: int = 3
