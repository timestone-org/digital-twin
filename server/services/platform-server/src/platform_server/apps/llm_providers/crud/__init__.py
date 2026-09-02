"""数据访问。只查询与写入，**不提交**——事务边界归 service 层。"""

from platform_server.apps.llm_providers.crud import assignment, provider

__all__ = ["assignment", "provider"]
