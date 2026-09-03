"""这一层装了哪几套重排线形，以及按方言码挑一套。

加一路方言 = 加一个实现文件 + 这份元组里一行 + 一条契约测试。注册是**显式
元组**，不靠 import 副作用（ADR-0029 决策四）。

⚠ 方言码是**跨服务契约**：平台侧配得出的那几个码与这里装了的那几个必须逐字
一致。漂开的表现是「界面上选得中、调用时说不认识」，而两边代码单看都对。

⚠ 认不出的码**当场抛**，不退回默认那一路：退回默认的表现是「配的方言一直
没生效」，而配置面看着一切正常——它打出去的是另一套线形，回来的多半是一条 404。
"""

from llmcore.rerank import dashscope, jina
from llmcore.rerank.dashscope import DIALECT_DASHSCOPE
from llmcore.rerank.jina import DIALECT_JINA
from llmcore.rerank.ports import RerankDialect

# 没配方言时走哪一路。⚠ 说这套线形的端点最多，故它当默认；换默认要改的是
# 平台侧那份校验的默认值，两边同一个字面量
DEFAULT_RERANK_DIALECT = DIALECT_JINA

DIALECTS: tuple[RerankDialect, ...] = (
    RerankDialect(
        code=DIALECT_JINA,
        path=jina.PATH,
        body_of=jina.body_of,
        scores_of=jina.scores_of,
    ),
    RerankDialect(
        code=DIALECT_DASHSCOPE,
        path=dashscope.PATH,
        body_of=dashscope.body_of,
        scores_of=dashscope.scores_of,
    ),
)

RERANK_DIALECTS: tuple[str, ...] = tuple(one.code for one in DIALECTS)


class UnknownRerankDialect(ValueError):
    """配的方言这一侧没装。"""


def dialect_of(code: str) -> RerankDialect:
    """按码挑一套线形；空串走默认那一路，认不出就抛。

    Args: code。
    """
    wanted = code or DEFAULT_RERANK_DIALECT
    for one in DIALECTS:
        if one.code == wanted:
            return one
    raise UnknownRerankDialect(
        f"这一侧没装叫 {wanted} 的重排线形。装了的有："
        f"{'、'.join(RERANK_DIALECTS)}"
    )
