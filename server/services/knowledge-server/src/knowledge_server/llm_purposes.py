"""本服务在模型目录里的用途码（ADR-0039）。放在服务级：嵌入与对话两层都要它。

⚠ 与 platform-server 的 `apps/llm_providers/enums.py` 逐字一致，由前端的契约
用例对着三份源码比对：漂开的表现是「界面上分配了、这一侧却还在用环境变量
那一档」，而三边代码单看都对。服务之间不许互相 import，故只能复述。
"""

# 对话页与 agentic 检索策略共用的模型
PURPOSE_CHAT = "knowledge.chat"
# 文档切块后按它转成向量
PURPOSE_EMBEDDING = "knowledge.embedding"
