"""台账面的权限码 —— 闸 2 用。

⚠ 逐字复述 auth-server 的权限码目录。功能模块之间只走对方的 `services` 公开面，
而权限码目录在另一个服务里，故只能复述；两边一致由
`tests/contract/test_route_matrix.py` 与 auth-server 侧的目录测试钉死。写歪一个
字符的表现是「边缘放行、端点拒绝」这类只在某几条路径上才出现的 403。

⚠ 这里只有七个码，不是 docs/DATASET_DESIGN.md §9 的八个：目录只登记**已经有
消费方**的码（auth-server CONTEXT.md §2），而 CSV 导出的端点还没落地。
它随自己的端点一起登记——权限码一经发布不许删除，先登记就等于把一个点了没
反应的开关永久钉在角色配置界面上。
"""

DATASET_VIEW = "dataset:view"
DATASET_MANAGE = "dataset:manage"
# 新增 / 修改 / 删除单行。⚠ 与 `dataset:manage` 分家是按爆炸半径切的：
# 改表结构影响的是往后每一行，改一行只影响那一行
DATASET_RECORD_WRITE = "dataset:record:write"
# 人工修正的写入、撤销与按列批量清除。修正值优先于点位聚合值，等同于篡改台账
DATASET_OVERRIDE = "dataset:override"
# 全表重算与历史回填：大批量改写历史行且吃满数据库
DATASET_BACKFILL = "dataset:backfill"
# 公式库读面。⚠ 与 `dataset:view` 分家：公式库是跨台账的全局资源，
# 看得见某一张台账不等于看得见全局口径
FORMULA_VIEW = "formula:view"
# 公式库写面。⚠ **与 `dataset:manage` 分家是刻意的**：改一条库公式会同时改掉
# **所有**引用它的台账列，爆炸半径比改单张表的一列大一个量级，不该被同一个码
# 顺带授予（docs/DATASET_DESIGN.md §9）
FORMULA_MANAGE = "formula:manage"
