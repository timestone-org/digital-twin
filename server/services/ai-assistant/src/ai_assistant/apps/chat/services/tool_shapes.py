"""一个工具的对外形状：叫什么、收什么参数、**在哪一侧执行**。

⚠ `runs_on` 是这份形状里最要紧的一格。服务端工具在本进程里跑完就有结果；
客户端工具要下发到浏览器、由编辑器执行，回合会在那里停下来等。两者的失败
含义也不同：服务端工具失败是我们的问题，客户端工具失败意味着那一页根本没
实现它——得如实告诉模型别再调（ADR-0023）。
"""

from dataclasses import dataclass
from typing import Any, Literal

ToolSide = Literal["server", "client"]


@dataclass(frozen=True)
class ToolSpec:
    """一个工具的对外形状。`name` 与技能清单里登记的逐字相同。"""

    name: str
    description: str
    # JSON Schema 的 `object` 段。⚠ 每个字段都要写 description：模型只能靠它
    # 判断该填什么，缺了的那一格它会自己编一个看起来合理的值
    parameters: dict[str, Any]
    runs_on: ToolSide


def openai_schema(spec: ToolSpec) -> dict[str, Any]:
    """摊成 OpenAI 兼容端点认的函数声明。

    Args: spec。
    """
    return {
        "type": "function",
        "function": {
            "name": spec.name,
            "description": spec.description,
            "parameters": spec.parameters,
        },
    }


def object_schema(
    properties: dict[str, Any], required: list[str]
) -> dict[str, Any]:
    """一个工具的参数段。

    Args: properties, required。
    """
    return {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": False,
    }


def string_schema(description: str) -> dict[str, Any]:
    """一格字符串参数。

    Args: description。
    """
    return {"type": "string", "description": description}


def integer_schema(description: str) -> dict[str, Any]:
    """一格整数参数。

    Args: description。
    """
    return {"type": "integer", "description": description}


def string_array_schema(description: str, item: str) -> dict[str, Any]:
    """一格字符串数组参数。

    Args: description, item（每一项写什么）。
    """
    return {
        "type": "array",
        "description": description,
        "items": {"type": "string", "description": item},
    }
