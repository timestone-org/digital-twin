"""能力面的装配：把配置与此刻的模型档摊成出参。

⚠ 报的是「此刻真能用什么」，不是「配置想要什么」。两者不一致时以真实为准，
并把原因一并说出来——悄悄退化的表现是「有点慢」「有点不准」，而没有人会去查
一件没人说过的事。
"""

from dataclasses import dataclass

from knowledge_server.apps.knowledge.models.knowledge_base import STRATEGIES
from knowledge_server.apps.knowledge.schemas import (
    CapabilityOut,
    IndexCapabilityOut,
    ParsingCapabilityOut,
    RerankCapabilityOut,
)
from knowledge_server.apps.knowledge.services.indexing import PGVECTOR, TRGM
from knowledge_server.apps.knowledge.services.parsing import (
    PARSERS,
    DocumentParser,
    ExternalParserBackend,
    accepted_suffixes,
)
from knowledge_server.apps.knowledge.services.retrieval import (
    RetrievalStrategy,
)
from knowledge_server.apps.knowledge.services.sources import (
    KnowledgeSource,
    source_kinds,
)
from knowledge_server.settings import Settings

# 外部解析后端一路都没接时报的原因。⚠ 是一句人话不是空串：空串会被界面读成
# 「一切正常」，而这里要说的是「这套部署根本没接那一路」（ADR-0043）
EXTERNAL_PARSER_ABSENT = (
    "这套部署没接外部解析服务（MinerU / PP-Structure 这一类）"
)


def index_capability_of(
    column_dimensions: int, model_dimensions: int = 0
) -> IndexCapabilityOut:
    """检索由哪两路组成，以及维数此刻对不对得上。

    ⚠ 两路都没有回退档（ADR-0045），所以这两格是定值。要报的是另一件事：
    库上那一列的维数与此刻这一路嵌入模型的维数**对不上**——那时每一份文档都会
    摄取失败，而只看文档状态的话，那句错像是文档本身有问题。

    Args: column_dimensions（库上那一列的维数）, model_dimensions（此刻这一路
        嵌入模型的维数；0 = 没接）。
    """
    return IndexCapabilityOut(
        vector=PGVECTOR,
        keyword=TRGM,
        reason=_dimension_gap(column_dimensions, model_dimensions),
    )


def _dimension_gap(column: int, model: int) -> str:
    """维数对不上时说的那句话；对得上或没接时是空串。

    Args: column（库上那一列的维数）, model（模型算出来的维数）。
    """
    if model in (0, column):
        return ""
    return (
        f"这套部署的向量列是 {column} 维，而模型管理页上分配的嵌入模型算出来的"
        f"是 {model} 维：这样的文档一份都摄取不进来。把 "
        "KNOWLEDGE_EMBEDDING_DIMENSIONS 改成模型的维数，重建向量表后重新解析"
    )


def parsing_capability_of(
    external: tuple[ExternalParserBackend, ...],
    parsers: tuple[DocumentParser, ...] = PARSERS,
) -> ParsingCapabilityOut:
    """解析那一层此刻装了哪几路后端。

    ⚠ 外部那一路没接就如实报空表加一句原因，不装作接上了：装了的表现是
    「界面写着接了 MinerU，传上去却报一句谁也看不懂的错」。

    Args: external, parsers。
    """
    return ParsingCapabilityOut(
        local_backends=[one.name for one in parsers],
        external_backends=[one.name for one in external],
        reason="" if external else EXTERNAL_PARSER_ABSENT,
    )


def ready_strategies(
    strategies: tuple[RetrievalStrategy, ...], *, is_model_enabled: bool
) -> list[str]:
    """此刻**真能用**的检索策略。

    ⚠ 与「装了哪些」分开报：靠模型撑起来的那一路在没配对话档时如实不可用，
    **不悄悄退化成别的**——悄悄退化的表现是「质量忽然变差了」，
    而没有任何一处报错（ADR-0035 决策二）。

    ⚠ 判据问的是**策略自己**（`is_llm_backed`），不是在这里写死一句
    「agentic 要模型」：写死的话，加第二路要模型的策略时这里会漏判，
    而漏判的表现是界面上把一路点不动的策略摆出来。

    Args: strategies, is_model_enabled（对话档此刻接没接）。
    """
    return [
        one.name
        for one in strategies
        if is_model_enabled or not one.is_llm_backed
    ]


# 没接重排时说得出的那句话。⚠ 一定要说：没接时检索走的是融合名次那一档，
# 而悄悄退化的表现正是「质量忽然变了、一处都不报错」
# 接了但一直排不成时说的那句。⚠ 要说得出下一步：只说「不可用」会让人去查
# 网络，而真正该看的是那个端点应不应答
RERANK_FAILING_REASON = (
    "重排这一路接着，但连着几次没排成，已暂时短路——检索照常返回融合名次。"
    "去看一眼那个重排端点应不应答"
)

NO_RERANK_REASON = (
    "模型管理页上还没给「知识库重排」分配模型，本部署按融合名次给出结果"
)


@dataclass(frozen=True)
class ModelLanes:
    """几路模型此刻接没接。

    ⚠ 由适配器**此刻**回答，不由配置回答：端点来自运行期可改的目录
    （ADR-0039），配置里的开关只是它的永久默认值。
    """

    is_embedding_enabled: bool
    is_model_enabled: bool
    # 此刻这一路嵌入模型算出来的维数。⚠ 要报出来：它与库上那一列对不上时，
    # 每一份文档都会摄取失败，而那条错看着像是文档的问题
    embedding_dimensions: int = 0
    # 重排接没接，以及此刻用的是哪个模型。⚠ 缺省是「没接」：这一格是后加的，
    # 不给它的调用点本来就没有这一路
    is_rerank_enabled: bool = False
    # 接着却排不成（断路器不是关着的）。⚠ 与「没接」分开：那是常态，这是毛病
    is_rerank_failing: bool = False
    rerank_model: str = ""


def rerank_capability_of(lanes: ModelLanes) -> RerankCapabilityOut:
    """重排那一路此刻的样子。

    ⚠ 「接了」与「接了而且排得成」是两件事。实测过一次：端点接着、
    `/v1/models` 秒回、`/v1/rerank` 挂住不回，于是每次检索先等满超时，
    而这里报的是「接了、一切正常」——那正是 §4.2 那条设计原则要防的
    「悄悄退化」，只不过它当时只覆盖了「没接」那一档。

    Args: lanes。
    """
    if not lanes.is_rerank_enabled:
        return RerankCapabilityOut(is_enabled=False, reason=NO_RERANK_REASON)
    return RerankCapabilityOut(
        is_enabled=True,
        model=lanes.rerank_model,
        reason=RERANK_FAILING_REASON if lanes.is_rerank_failing else "",
    )


@dataclass(frozen=True)
class Installed:
    """这套部署装了哪几路。

    ⚠ 打成一包而不是逐个形参：调用面的形参上限是 5，而「装了哪些」天然会继续
    长（来源、检索策略、外部解析后端……）。到顶那天最省事的改法是把新的那一路
    塞进已有的某一格里，而那正是让两路开始互相知道对方的第一步。
    """

    sources: tuple[KnowledgeSource, ...] = ()
    strategies: tuple[RetrievalStrategy, ...] = ()
    # ⚠ 这一格漏传过一次就够了：`accepted_suffixes` 少了它只报本地那几路，
    # 表现是「接了 MinerU、界面还是不收 PDF」，而两边单看都对
    external_parsers: tuple[ExternalParserBackend, ...] = ()


def capability_of(
    settings: Settings,
    column_dimensions: int = 0,
    installed: Installed | None = None,
    lanes: ModelLanes | None = None,
) -> CapabilityOut:
    """这套部署此刻的知识库能力。

    Args: settings, column_dimensions（库上向量列的维数；0 = 还没问到，
        按配置值算）, installed（装了哪几路来源/策略/外部解析后端）,
        lanes（几路模型此刻接没接；不给就按配置里的开关答）。
    """
    installed = installed or Installed()
    if lanes is None:
        lanes = ModelLanes(
            is_embedding_enabled=settings.embedding_enabled,
            is_model_enabled=settings.model_enabled,
        )
    return CapabilityOut(
        is_embedding_enabled=lanes.is_embedding_enabled,
        is_model_enabled=lanes.is_model_enabled,
        is_asr_enabled=settings.asr_enabled,
        strategies=list(STRATEGIES),
        ready_strategies=ready_strategies(
            installed.strategies, is_model_enabled=lanes.is_model_enabled
        ),
        source_kinds=list(source_kinds(installed.sources)),
        accepted_suffixes=list(accepted_suffixes(installed.external_parsers)),
        parsing=parsing_capability_of(installed.external_parsers),
        index=index_capability_of(
            column_dimensions or settings.embedding_dimensions,
            lanes.embedding_dimensions,
        ),
        rerank=rerank_capability_of(lanes),
    )
