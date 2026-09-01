"""检索的出入参。"""

import uuid

from pydantic import BaseModel, Field

from knowledge_server.settings import MAX_RETRIEVAL_HITS


class SearchIn(BaseModel):
    """一次检索。"""

    query: str = Field(min_length=1, max_length=2_000)
    limit: int = Field(default=8, ge=1, le=MAX_RETRIEVAL_HITS)
    # 这一次走哪种策略；留空即用库上配的那一种。
    # ⚠ 认不出的名字当场拒，不退回默认——退回的表现是「配的策略一直没生效」
    strategy: str = ""


class LocatorOut(BaseModel):
    """一条召回在原件里的位置。

    ⚠ 各格按格式各取所需：pdf 与 pptx 用 `page`，xlsx 用 `sheet` + `row`，
    md 与 docx 用 `path`。硬凑一个统一的「行号」会让「第 3 行」在不同格式里
    指着完全不同的东西。
    """

    page: int | None = None
    sheet: str = ""
    row: int | None = None
    path: list[str] = Field(default_factory=list)
    # 给人看的一句位置，前端直接显示。⚠ 由后端拼：各端各拼一份一定会漂
    label: str = ""


class HitOut(BaseModel):
    """一条召回，自带够用来核对的出处。"""

    chunk_id: uuid.UUID
    document_id: uuid.UUID
    document_title: str
    text: str
    heading_path: str
    locator: LocatorOut
    score: float
    # 它凭什么排在这。⚠ 交出去而不是自己吞掉：选哪一条由调用方定，
    # 因为只有它知道用户这句话的上下文
    why: str


class SearchOut(BaseModel):
    """一次检索的结果。"""

    hits: list[HitOut]
    strategy: str
    rounds: int
    # 到顶了没查全吗。⚠ 如实说：装作查完了的话，调用方会把「就这些」当成事实
    is_complete: bool
    # 给人看的一句说明（「这套部署没接嵌入档，本次只走了关键词那一路」这类）。
    # ⚠ 走这里而不是走空表：空表与「确实没有相关内容」长得一模一样
    note: str
