"""数据访问。只做查询与写入，**不提交**——事务边界归 service 层。"""

from knowledge_server.apps.knowledge.crud import (
    chunk,
    document,
    figure,
    knowledge_base,
    source,
)

__all__ = ["chunk", "document", "figure", "knowledge_base", "source"]
