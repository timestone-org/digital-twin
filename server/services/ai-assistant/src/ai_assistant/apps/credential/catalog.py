"""本模块的权限码字面量 —— 闸 2 用。

⚠ **权限码目录的唯一真源是 auth-server 的 `apps/auth/catalog/permissions.py`**：
两边必须逐字一致——写歪一个字符的表现是「边缘放行、端点拒绝」这类只在某几条
路径上才出现的 403，而两侧代码单看都对。服务之间不许互相 import，故只能复述。
"""

# 管模型账号：登录、退出、看得见凭据的过期时刻
ASSISTANT_MANAGE = "assistant:manage"
