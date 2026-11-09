"""按工作面分档的两张表必须覆盖同一组工作面。

守的是「加了一个工作面只改了一处」：提示词里的页面名与撤销模型各写一张表，
漏改的那一张不报错，只是提示词说「当前业务页面」、或撤销口径退回默认。
"""

from ai_assistant.apps.chat.services.memory.prompt import SURFACE_LABELS
from ai_assistant.apps.chat.services.reflection.hitl import SURFACE_UNDO


def test_the_prompt_labels_and_undo_models_cover_the_same_surfaces() -> None:
    assert set(SURFACE_LABELS) == set(SURFACE_UNDO)
