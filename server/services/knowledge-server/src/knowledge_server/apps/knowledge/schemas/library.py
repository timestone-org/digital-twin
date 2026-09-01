"""知识库与来源的出入参。ORM 模型不许直接返给 HTTP 层。"""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator

from knowledge_server.apps.knowledge.models.knowledge_base import (
    DESCRIPTION_MAX_LENGTH,
    NAME_MAX_LENGTH,
    STRATEGIES,
)


class KnowledgeBaseIn(BaseModel):
    """建库的入参。

    ⚠ 嵌入档与维数**不收**：它们由服务端按此刻接得上的那一路填，而不是由
    调用方指定。让调用方指定的话，一个写错维数的请求会让整库的向量从第一条
    起就算不出有意义的余弦，而没有任何一处会报错。
    """

    name: str = Field(min_length=1, max_length=NAME_MAX_LENGTH)
    description: str = Field(default="", max_length=DESCRIPTION_MAX_LENGTH)
    # ⚠ 用字符串加校验而不是数字枚举：禁数字枚举是全服务统一口径，
    # 而这一格的取值同时是数据库 CHECK 与检索策略注册表的名字
    retrieval_strategy: str = Field(default="hybrid")

    @field_validator("retrieval_strategy")
    @classmethod
    def _strategy_must_be_known(cls, given: str) -> str:
        """认不出的策略名当场拒，不悄悄退回默认。

        ⚠ 退回默认的表现是「配的策略一直没生效」，而配置面看着一切正常。

        ⚠ 做成**字段校验器**而不是一个要调用方记得调的方法：方法漏调不报错，
        而漏调的表现是一条数据库 CHECK 挡下来的 500——那句错里不会提到
        「策略名写错了」。

        Args: given。
        """
        if given not in STRATEGIES:
            raise ValueError(f"没有叫 {given} 的检索策略")
        return given


class KnowledgeBaseOut(BaseModel):
    """一个库的样子。"""

    id: uuid.UUID
    name: str
    description: str
    retrieval_strategy: str
    # 算这个库全部向量的那一路与维数。没接嵌入时都是 null——那时检索如实回答
    # 「这个库还没建索引」，不是返回空表
    embedding_model: str | None
    dimensions: int | None
    owner_id: str
    document_count: int
    created_at: datetime
    updated_at: datetime


class SourceIn(BaseModel):
    """加一路来源的入参。"""

    kind: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=NAME_MAX_LENGTH)
    # 这一路自己的配置，形状由它的 `config_schema()` 定。⚠ 是只自由袋子：
    # 写一个这一路不认识的键既不报错也不生效，所以入库前要按 schema 校验
    config: dict[str, Any] = Field(default_factory=dict)


class SourceOut(BaseModel):
    """一路来源的样子。"""

    id: uuid.UUID
    base_id: uuid.UUID
    kind: str
    name: str
    config: dict[str, Any]
    last_synced_at: datetime | None
    # 上一次同步失败的原因。⚠ 留着而不是清掉：清掉的话界面上是「从没同步过」，
    # 而那与「同步了但一直失败」是两件事
    last_error: str
    created_at: datetime


class SyncOut(BaseModel):
    """跑一次来源同步的结果。"""

    registered: int
    # 内容重复而跳过的条数。⚠ 单独报：与「登记了 0 条」分开，
    # 前者是「没有新东西」，后者可能是路径配错了
    skipped: int
    # 到了页数上限还没拉完吗。⚠ 如实说：装作拉完了的话，用户不会再按第二次，
    # 而剩下的记录永远进不来
    has_more: bool
