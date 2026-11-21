"""画布绑定与读数工具共用的筛选与分页参数。"""

from typing import Any


def binding_read_parameters() -> dict[str, Any]:
    """返回稳定实体、槽位及有界窗口的参数定义。"""
    return {
        "slot_key": {
            "type": ["string", "null"],
            "description": ("槽键精确筛选，如 partFieldValues；空值不限定"),
        },
        "entity_id": {
            "type": ["string", "null"],
            "description": ("真实实体 id，包含该实体的全部字段；空值不限定"),
        },
        "keyword": {
            "type": ["string", "null"],
            "description": "匹配实体名、身份或字段槽键；空值不限定",
        },
        "offset": {
            "type": "integer",
            "minimum": 0,
            "maximum": 9007199254740991,
            "description": "首次省略或给 0，续读使用回执 next_offset",
        },
        "limit": {
            "type": "integer",
            "minimum": 1,
            "maximum": 20,
            "description": "最多读取的行数，默认 20",
        },
    }
