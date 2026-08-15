"""素材面的权限码。

⚠ 逐字复述 auth-server 的权限码目录。功能模块之间只走对方的 `services` 公开面，
而权限码目录在另一个服务里，故只能复述；两边一致由
`tests/contract/test_asset_route_matrix.py` 与 auth-server 侧的目录测试钉死。

素材是**跨大屏的公共资源**（一个模型可以被十张屏引用），故自成一族而不是复用
`dashboard:*`：把删素材的权力顺带发给每个能编大屏的人，一次误删会打穿十张屏。
"""

ASSET_VIEW = "asset:view"
ASSET_MANAGE = "asset:manage"
