"""模块清单的读取面 —— Agent 生成大屏时的地图，也是服务端校验的依据。

⚠ 清单的**唯一真源在前端**（渲染组件与它同处一地才不会漂）；`module_types.json`
是前端在构建期导出的产物，进版本库、由 tests/contract 锁死两侧一致。漏了那道
测试，Agent 会按过期清单生成配置，而配置在前端渲染成空白（ADR-0012 五）。
"""

import re
from dataclasses import dataclass
from pathlib import Path

from pydantic import ValidationError

from platform_server.apps.dashboard.errors import ModuleCatalogUnreadable
from platform_server.apps.dashboard.schemas.module_type import (
    BindingSpecOut,
    CatalogTypeDocOut,
    ModuleCatalogOut,
    ModuleTypeOut,
)

CATALOG_FILE = Path(__file__).resolve().parent.parent / "module_types.json"
# 数组槽的 `field_key` 形状：`anchorValues[0].value`
ARRAY_KEY_SEPARATOR = "]."
# 槽名随前端清单，是 camelCase；首字母仍限小写，好把类型名一类的东西挡在外面。
# ⚠ 收成纯 snake_case 会把 `anchorValues` 判成非法槽，而表现是绑定保存被拒、
# 拒的理由却写成「模块没有这个绑定槽」——看着像清单缺声明，其实是解析器不认。
_SLOT_NAME = re.compile(r"^[a-z][A-Za-z0-9_]*$")


@dataclass(frozen=True)
class ModuleSlots:
    """一个模块声明的全部绑定槽。"""

    scalar_keys: frozenset[str]
    array_fields: dict[str, frozenset[str]]
    # 行钉在实体上的那些数组槽。⚠ 只有它们允许索引留空：行数由配置里的实体数
    # 决定，绑一部分实体是常态，空出来的行只表示那个实体没接数据源
    entity_pinned: frozenset[str] = frozenset()


@dataclass(frozen=True)
class ModuleCatalog:
    """一份模块清单，进程内只读。"""

    catalog_version: int
    modules: tuple[ModuleTypeOut, ...]
    # 「配置字段的 type / 绑定槽的 data_type 各是什么形状的值」这两张图例。
    # ⚠ 与模块表同一份产物、同一次装载：分开维护的话，前端加一档类型而这里
    # 没跟上时，Agent 读到的是一个它不认识的 `type`，只能猜值的形状
    field_types: tuple[CatalogTypeDocOut, ...] = ()
    binding_data_types: tuple[CatalogTypeDocOut, ...] = ()

    def known_types(self) -> frozenset[str]:
        """全部已注册的模块类型。"""
        return frozenset(module.type for module in self.modules)

    def find(self, module_type: str) -> ModuleTypeOut | None:
        """按类型取一个模块清单，没有就给 None。

        Args: module_type。
        """
        return next(
            (item for item in self.modules if item.type == module_type), None
        )

    def slots(self, module_type: str) -> ModuleSlots:
        """一个模块的绑定槽。未注册的类型给空槽集。

        Args: module_type。
        """
        module = self.find(module_type)
        if module is None:
            return ModuleSlots(scalar_keys=frozenset(), array_fields={})
        return ModuleSlots(
            scalar_keys=frozenset(
                spec.key for spec in module.bindings if not spec.is_array
            ),
            array_fields={
                spec.key: _array_field_keys(spec)
                for spec in module.bindings
                if spec.is_array
            },
            entity_pinned=frozenset(
                spec.key
                for spec in module.bindings
                if spec.is_array and spec.is_entity_pinned
            ),
        )


def _array_field_keys(spec: BindingSpecOut) -> frozenset[str]:
    return frozenset(field.key for field in spec.array_fields or ())


@dataclass(frozen=True)
class ParsedFieldKey:
    """拆开的绑定槽键。`array_index` 为空表示这是一个标量槽。"""

    slot: str
    array_index: int | None
    sub_key: str | None


def parse_field_key(field_key: str) -> ParsedFieldKey | None:
    """把 `anchorValues[0].value` 拆成槽名、索引与子槽；形状不符给 None。

    Args: field_key。
    """
    head, separator, sub_key = field_key.partition(ARRAY_KEY_SEPARATOR)
    if not separator:
        if not _SLOT_NAME.match(field_key):
            return None
        return ParsedFieldKey(slot=field_key, array_index=None, sub_key=None)
    slot, bracket, index = head.partition("[")
    if not bracket or not index.isdigit():
        return None
    if not _SLOT_NAME.match(slot) or not _SLOT_NAME.match(sub_key):
        return None
    return ParsedFieldKey(slot=slot, array_index=int(index), sub_key=sub_key)


def load_module_catalog() -> ModuleCatalog:
    """从提交进仓的清单文件装出目录。装不出即部署产物有问题。"""
    try:
        raw = CATALOG_FILE.read_text(encoding="utf-8")
        parsed = ModuleCatalogOut.model_validate_json(raw)
    except (OSError, ValidationError) as error:
        raise ModuleCatalogUnreadable("模块清单不可用") from error
    return ModuleCatalog(
        catalog_version=parsed.catalog_version,
        modules=tuple(parsed.modules),
        field_types=tuple(parsed.field_types),
        binding_data_types=tuple(parsed.binding_data_types),
    )
