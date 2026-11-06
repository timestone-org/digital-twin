"""模型版本的指纹：这个版本是拿什么训出来的、在什么环境里训的。"""

import sys
from typing import Any

import numpy
import sklearn

# 指纹的线形版本。⚠ 与可服务表示那个版本号**各走各的**：两者形状变化的时机
# 无关，共用一个的话，升可服务表示会让所有历史指纹看起来也换了口径
FINGERPRINT_FORMAT_VERSION = "1.0"


def fingerprint(
    row_count: int | None, table_codes: list[str]
) -> dict[str, Any]:
    """这个版本是拿什么训出来的、在什么环境里训的。

    ⚠ 记下依赖版本不是留档：跨版本反序列化与跨版本数值差异都会让「同一个模型」
    算出不同的数，而没有指纹的话没人查得出来。
    Args: row_count, table_codes。
    """
    return {
        "format_version": FINGERPRINT_FORMAT_VERSION,
        "python": sys.version.split()[0],
        "numpy": numpy.__version__,
        "sklearn": sklearn.__version__,
        "rows": row_count,
        "table_codes": sorted(table_codes),
    }
