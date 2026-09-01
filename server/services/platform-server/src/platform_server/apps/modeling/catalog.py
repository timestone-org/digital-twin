"""建模面的权限码 —— 闸 2 用。

⚠ 逐字复述 auth-server 的权限码目录。功能模块之间只走对方的 `services` 公开面，
而权限码目录在另一个服务里，故只能复述；两边一致由契约测试钉死。写歪一个字符
的表现是「边缘放行、端点拒绝」这类只在某几条路径上才出现的 403。
"""

MODELING_VIEW = "modeling:view"
# 建改删流水线、校验、导出导入
MODELING_MANAGE = "modeling:manage"
# 发起与取消运行。⚠ 与 manage 分家：生产环境上允许配图、但未必允许在业务高峰
# 跑一个吃满 CPU 的训练
MODELING_RUN = "modeling:run"
# 发布模型版本、建改删绑定。⚠ **与 run 必须分家**：能跑实验 ≠ 能把模型接进
# 生产台账。它的爆炸半径是「所有引用该公式条目的台账列的数值全变」，
# 与 `formula:manage` 同一量级（docs/MODELING_DESIGN.md §9.1）
MODELING_PUBLISH = "modeling:publish"
