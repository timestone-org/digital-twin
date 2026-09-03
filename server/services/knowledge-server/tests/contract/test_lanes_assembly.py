"""装 `Lanes` 只许有一处。

⚠ 这一条守的是一类静默失效：`Lanes` 的每一格都有诚实缺席的缺省值，所以漏传
一格既不报错也不炸——漏掉重排那一格的表现是能力面说「已接重排」，而那条链路
照旧按融合名次出结果。差异只在结果顺序上，没有任何一处会讲出来。

⚠ 按**源码**扫而不是按调用行为断言：漏传发生在装配那一行，而装配跑不跑得到
取决于这套部署接没接那几路——用例里接不上的那几路正是最容易漏的那几路。
"""

import re
from pathlib import Path

import knowledge_server

# 装一包 `Lanes`。⚠ 前面那个否定环视是为了不把 `ModelLanes(` 一起算进来
_BUILDS_LANES = re.compile(r"(?<![A-Za-z_])Lanes\(")

# 唯一许可的那一处
_HOME = "apps/knowledge/services/assembly.py"


def _sources() -> list[Path]:
    """本服务的全部源码文件。"""
    root = Path(knowledge_server.__file__).parent
    return sorted(root.rglob("*.py"))


def test_only_the_assembly_module_builds_lanes() -> None:
    root = Path(knowledge_server.__file__).parent
    offenders = [
        one.relative_to(root).as_posix()
        for one in _sources()
        if _BUILDS_LANES.search(one.read_text(encoding="utf-8"))
        and one.relative_to(root).as_posix() != _HOME
    ]
    assert (
        not offenders
    ), f"这几处自己装了 Lanes：{offenders}；改走 assembly.lanes_of"
