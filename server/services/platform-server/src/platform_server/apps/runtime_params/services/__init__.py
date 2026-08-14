"""运行参数的业务层，也是本模块对外的公开面。

事务边界在这一层：crud 不提交，api 不写业务。
"""

from platform_server.apps.runtime_params.services import param_service

__all__ = ["param_service"]
