"""订阅账号那一路 —— 共用件在 `llmcore.codex`，这里只再导出。

⚠ 不在这里另建一套：模型构造、令牌来源与线形改写两个消费方共用（ADR-0041），
复制一份一定会漂，而漂的表现是「同一个订阅账号，助手说得了话、知识库说不了」。
"""

from llmcore.codex import CodexRewire

__all__ = ["CodexRewire"]
