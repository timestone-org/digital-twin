"""订阅账号那一路里**本服务独有**的部分：工具名的线形改写。

模型构造与令牌来源在 `llmcore.codex`（两个消费方共用，ADR-0041）；这里只留
「本服务的工具名带点号，而那个端点不认」这一条特例。
"""

from ai_assistant.llm.codex.rewire import CodexRewire

__all__ = ["CodexRewire"]
