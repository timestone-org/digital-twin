"""一档端点的形状。回落链由调用方算完，这里只收结果。

⚠ 适配器只认这个形状，不去读调用方的配置对象。读格子的话，「视觉档回落到
对话档」这条链会在每个适配器里各写一遍，而写漏的那一份表现为「改了配置没生效」。

⚠ 密钥装在 `SecretStr` 里：从形状上就不许它被 print 或写进日志。
"""

from dataclasses import dataclass
from typing import Any

from pydantic import SecretStr


@dataclass(frozen=True)
class ChatEndpoint:
    """一档对话（或看图）端点实际要打的地方。"""

    base_url: str
    api_key: SecretStr
    model: str
    timeout_s: float
    # 端点方言里的额外请求体。⚠ 思考过程一类的开关在 OpenAI 兼容口径里没有标准
    # 字段，各家用自己的键——而代码里不认厂商名，于是它只能是一格透传的取值
    extra_body: dict[str, Any] | None = None


@dataclass(frozen=True)
class EmbeddingEndpoint:
    """嵌入端点实际要打的地方。

    ⚠ 与 `ChatEndpoint` 分开而不是共用一个形状：嵌入没有「思考过程」一类的方言
    开关，却多一格**维数**——而维数是要落库对账的（换了模型而维数变了的话，
    旧条目与新条目算不出有意义的余弦，表现只是「召回忽然变差了」）。
    """

    base_url: str
    api_key: SecretStr
    model: str
    timeout_s: float
    dimensions: int
