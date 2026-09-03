"""能力面的出参：这套部署此刻能干什么。"""

from pydantic import BaseModel, Field


class IndexCapabilityOut(BaseModel):
    """检索由哪两路组成，以及此刻有没有毛病。

    ⚠ 两路都没有回退档了（ADR-0045），所以这两格恒为 `pgvector` 与 `trgm`。
    留着它们是因为界面要说得出「检索是怎么做的」，而 `reason` 仍然不是装饰：
    维数对不上这类毛病要在**传文档之前**就看得见——否则第一次发现它的方式是
    每一份文档都摄取失败。
    """

    # 这套部署的两路索引，取值同 `services/indexing/registry.py` 的注册名
    vector: str
    keyword: str
    # 此刻的毛病；一切正常时是空串
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


class RerankCapabilityOut(BaseModel):
    """重排那一路此刻接没接（ADR-0042）。

    ⚠ `reason` 不是装饰：没接时检索走的是融合名次那一档，而**悄悄退化**的
    表现正是「质量忽然变了、一处都不报错」。这一格就是那句话。
    """

    is_enabled: bool
    # 此刻用的重排模型名；没接时是空串
    model: str = ""
    # 没接时说得出为什么；接上了是空串
    reason: str = ""


class CapabilityOut(BaseModel):
    """知识库能力。"""

    # 嵌入档接上了吗。⚠ 没接时**摄取不了任何文档**：向量是检索的必经一路
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
    # 重排接没接。⚠ 与嵌入不同，换重排模型**不作废任何存量向量**：
    # 界面上别把它说成「换了要重建」
    rerank: RerankCapabilityOut
