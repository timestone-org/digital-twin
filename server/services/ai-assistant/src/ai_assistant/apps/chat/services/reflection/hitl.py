"""让人来拍板的两种形态，与各自的边界。

同一件事在本仓有两副面孔，分界线是**这一页有没有撤销栈**：

- **`user.ask` 问一句再动手** —— 大屏 / 孪生编辑器。那里改动落在草稿里、
  用户随时能撤，所以只有危险动作才值得先问。
- **只提议、由用户点确认才落库** —— 台账 / 采集。那里**没有撤销**，
  每一次写入都是真实落库。

⚠ `user.ask` 是**内建客户端工具**，不归任何技能（`intent/select.py` 文件头写了
同一条）。把它写进某个技能的 `client_tools` 会让老前端那条退回推导也把它发出去，
而老前端不认识它——模型于是调一个每次都失败的工具。

⚠ 这一份是**口径说明**，不是执行路径：`user.ask` 由浏览器执行
（`web/app/src/features/ai/builtinTools.ts`），提议式写入由各页面自己收口。
服务端在这里只登记「哪些工作面属于哪一档」，供提示词与评审对照。
"""

from typing import Literal

# 这一页改动落在哪里。⚠ 决定的是「先问还是先做」，不是权限
UndoModel = Literal["draft", "commit"]

# 工作面 → 撤销模型。⚠ 认不出的工作面按 `commit` 兜底：把一个没有撤销栈的页面
# 误当成有撤销栈的，代价是助手直接写库；反过来只是多问一句
SURFACE_UNDO: dict[str, UndoModel] = {
    "dashboard-editor": "draft",
    "twin-editor": "draft",
    "twin2d-editor": "draft",
    "dataset-table": "commit",
    "collect-source": "commit",
    "dashboard-view": "commit",
}


def undo_model_of(surface_kind: str) -> UndoModel:
    """这一页的改动撤不撤得回来。

    Args: surface_kind。
    """
    return SURFACE_UNDO.get(surface_kind, "commit")


def must_propose_only(surface_kind: str) -> bool:
    """这一页是不是「只提议、不落库」。

    Args: surface_kind。
    """
    return undo_model_of(surface_kind) == "commit"
