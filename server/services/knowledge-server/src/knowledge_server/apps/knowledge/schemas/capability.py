"""能力面的出参：这套部署此刻能干什么。"""

from pydantic import BaseModel, Field


class IndexCapabilityOut(BaseModel):
    """检索那两路各自走在哪一档上。

    ⚠ `reason` 不是装饰：走在回退档上时用户要看得见**为什么**。
    悄悄退化的表现是「有点慢」「有点不准」，而没有人会去查一件没人说过的事
    （ADR-0034 决策五）。
    """

    # 实际生效的那一档，取值同 `services/indexing/registry.py` 的注册名
    vector: str
    keyword: str
    # 走在回退档上的原因；走在首选档上时是空串
    reason: str = ""


class ParsingCapabilityOut(BaseModel):
    """解析那一层此刻装了哪几路后端（ADR-0043）。

    ⚠ 外部那一路**没接就是空表**，不摆一个看着能用的占位：占位的表现是
    「界面上写着接了 MinerU，传上去却报一句谁也看不懂的错」。
    """

    # 本地库解那一路（在进程池里跑）装了哪几个，按注册序
    local_backends: list[str] = Field(default_factory=list)
    # 外部解析服务那一路此刻接了哪几个
    external_backends: list[str] = Field(default_factory=list)
    # 外部那一路缺席的原因；接上了是空串
    reason: str = ""


class CapabilityOut(BaseModel):
    """知识库能力。"""

    # 嵌入档接上了吗。没接时文档照常摄取，检索如实回答「这个库还没建索引」
    is_embedding_enabled: bool
    # 对话档接上了吗。它只决定 `agentic` 策略可不可用
    is_model_enabled: bool
    # 语音输入接上了吗（ADR-0038）。前端靠它决定摆不摆麦克风键
    is_asr_enabled: bool
    # 这套部署装了哪些检索策略，以及哪些此刻真能用
    strategies: list[str] = Field(default_factory=list)
    ready_strategies: list[str] = Field(default_factory=list)
    # 装了哪些来源与解析器；界面的 accept 名单由后者算出来下发。
    # ⚠ 前端不再写死一份：两份漂开的表现是「选得中的文件传上去被拒」，
    # 而两边单看都对
    source_kinds: list[str] = Field(default_factory=list)
    accepted_suffixes: list[str] = Field(default_factory=list)
    parsing: ParsingCapabilityOut
    index: IndexCapabilityOut
