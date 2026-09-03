"""`lanes_of` 把此刻的那几路原样交出去。

⚠ 逐格断言而不是只断言「装出来了」：每一格都有诚实缺席的缺省值，漏传一格
装得出来、跑得起来、只是那一路悄悄失效。
"""

from dataclasses import dataclass

from knowledge_server.apps.knowledge.services.assembly import lanes_of


@dataclass(frozen=True)
class _Source:
    """只提供那五格的假容器；每一格都是个认得出的哨兵。"""

    settings: object
    index: object
    embedder: object
    answerer: object
    reranker: object


def test_lanes_of_carries_every_lane() -> None:
    source = _Source(
        settings=object(),
        index=object(),
        embedder=object(),
        answerer=object(),
        reranker=object(),
    )

    made = lanes_of(source)  # pyright: ignore[reportArgumentType]

    assert made.settings is source.settings
    assert made.probe is source.index
    assert made.embedder is source.embedder
    assert made.answerer is source.answerer
    assert made.reranker is source.reranker
