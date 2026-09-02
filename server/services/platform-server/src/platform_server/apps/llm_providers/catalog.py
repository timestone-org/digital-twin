"""模型供应商面的权限码。

⚠ 逐字复述 auth-server 的权限码目录（`apps/auth/catalog/permissions.py`）：
服务之间不许互相 import，故只能复述；两边一致由本服务的
`tests/contract/test_llm_route_matrix.py` 与 auth-server 侧的同名用例钉死。

模型供应商是**整套部署共用的**：一个端点同时喂助手与知识库，换掉它等于替
所有人换了说话的模型，故自成一族而不是挂在 `assistant:*` 或 `knowledge:*` 下。
"""

LLM_VIEW = "llm:view"
LLM_MANAGE = "llm:manage"
