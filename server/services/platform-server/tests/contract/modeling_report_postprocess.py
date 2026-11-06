"""预测后处理算子的全目录最坏负载。"""

from typing import Any

from platform_server.apps.modeling.operators import Frame, registry


def postprocess_loads(
    scored: Frame,
) -> dict[str, tuple[tuple[dict[str, Any], dict[str, Any]], ...]]:
    """后处理算子吃同一份打分帧，最坏负载只差在行数。Args: scored。"""
    return {
        code: (({"scored": scored}, {}),)
        for code in registry.codes()
        if registry.get(code).CATEGORY == "postprocess"
    }
