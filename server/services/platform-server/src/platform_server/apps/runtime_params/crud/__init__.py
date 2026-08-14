"""数据访问层。只做查询与写入，**不提交**——事务边界归 service 层。"""

from platform_server.apps.runtime_params.crud import override as override_crud
from platform_server.apps.runtime_params.crud.override import OverrideWrite

__all__ = ["OverrideWrite", "override_crud"]
