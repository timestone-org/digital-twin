# auth-server 上下文

认证、RBAC 权限判定、路由规则与边缘鉴权端点。数据在 `auth` schema，写独占（ADR-0003）。

---

## 1. 通用语言

| 词 | 指什么 | 不是什么 |
|---|---|---|
| **权限码**（code） | `<域>:<资源>:<动作>` 的字符串字面量，如 `user:grant` | 不是数字、不是角色 |
| **角色**（role） | 一组权限码的命名集合。一个用户**一个**角色 | 不是用户组 |
| **直权**（direct permission） | 叠加在角色之上、单独授予某个用户的码 | 不做减法，没有「负权限」 |
| **有效权限**（effective） | 角色权限 ∪ 直权 | —— |
| **内置**（builtin） | 由种子全量覆盖的角色与权限码 | 不是「系统预设但可改」 |
| **全权账号**（super admin） | 有效码集 ⊇ **内置码集**的账号 | 不看角色名，改名不影响判定 |
| **闸 1 / 闸 2 / 闸 3** | 路由规则 / 端点权限 / 前端门禁 | 见 §3 |
| **API 密钥**（api key） | 签发给某个账号的常驻凭据，权限完全继承该账号 | 不是第二套权限体系，见 §7.2 |

## 2. 权限码档位

| 档 | 含义 | 界面标注 |
|---|---|---|
| `view` | 看得到数据，改不动东西 | 查看 |
| `manage` | 改的是系统里的定义 | 管理 |
| `operate` | 对现场设备或历史数据产生真实副作用 | 操作（红标） |
| `admin` | 改的是「谁能做什么」，或影响面覆盖全局、不可逆 | 高危（红标） |

**要不要再拆的唯一判据：有没有人会只给其中一半。** 否定的就合并。

目录是 [`src/auth_server/apps/auth/catalog/`](src/auth_server/apps/auth/catalog/)，
它是全系统权限口径的**唯一真源**。只登记已有消费方的码——无端点无页面的占位码
会让角色配置界面摆出一排点了没反应的开关。

包内按职责分文件：`specs.py` 三种记录的形状、`permissions.py` 权限码、
`roles.py` 内置角色、`rules_<服务>.py` 各服务前缀的路由规则，`__init__.py` 把
`ROUTE_RULES` 拼起来并保持 `PERMISSIONS` / `ROLES` / `ROUTE_RULES` 三个名字不变。
⚠ **一个服务前缀的规则必须待在同一个文件里**：`fnmatch` 的 `*` 跨斜杠，窄规则
与兜底的优先级阶梯只有并排看才检查得出来。

当前 18 码 / 6 组 / 2 个内置角色 / 75 条内置路由规则。

## 3. 三道闸

| 闸 | 位置 | 判定依据 | 绕过后果 |
|---|---|---|---|
| 闸 1 · 路由规则 | 边缘调 `/internal/v1/verify` | `auth_route_rules` | 直连服务端口即绕过 |
| 闸 2 · 端点权限 | 各端点的 `require(...)` 依赖 | 调用者的有效码集 | 绕过边缘也生效 |
| 闸 3 · 前端门禁 | `web` 的路由守卫与 `PermGuard` | store 里的权限码 | **只是体验，不是边界** |

三条纪律：

1. 闸 3 **永远不是安全边界**。
2. 闸 1 与闸 2 对同一端点的权限码**必须一致**——双口径漂移完全静默，
   由 [`tests/contract/test_route_matrix.py`](tests/contract/test_route_matrix.py) 遍历真实路由表钉死。
3. 闸 1 **首条命中即终局**，命中但权限不足不会继续找更宽松的规则，
   所以**排序错了就是直接拒绝**。

### 3.1 `/verify` 的口径

**先认证、再查规则。** 空 `permission_codes` 的语义是「任意已登录用户放行」，
**不是**匿名放行——匿名可达性由边缘的免认证 location 保证。

把规则判定提到认证之前，会让 `/verify` 变成可被任意路径匿名探测的 oracle，
且 200 时不下发身份头会让上游拿到空身份。

## 4. 授权不变式

没有它们，「某个角色不含 X」只是种子配置的默认值，不是安全属性：
持 `role:manage` + `user:grant` 的账号三步即可自升全权（建角色 → 授全部码 → 改派自己）。

| 不变式 | 函数 | 挡的是 |
|---|---|---|
| 授予不超过自身 | `assert_grantable` | 凭空造出比自己高的权限 |
| 目标不高于自身 | `assert_target_not_higher` | 重置全权管理员的密码后接管账号 |
| 角色不高于自身 | `assert_role_not_higher` | 把高权角色**降**到自己这一层再劫持 |
| 内置对象不可改 | `assert_builtin_role_mutable` | 改内置角色名（那是种子的幂等键） |
| 自锁保护 | `assert_not_self` / `assert_not_last_super_admin` / `assert_keeps_admin_capability` | 把自己或系统锁死 |

全权账号对前三条豁免。判定看的是**内置码集**，不是角色名。

## 5. URL 形状

对外 `/api/v1/auth/<资源复数>`，动作端点 `POST …:verb`。内部面挂 `/internal/v1/`，
边缘对 `/internal/` 一律 deny。

| 端点 | 权限码 |
|---|---|
| `POST /sessions` · `POST /sessions:refresh` · `POST /sessions:revoke` | （空，需边缘免认证 location） |
| `POST /registrations` | （空，同上；默认未开放） |
| `GET|PATCH /users/me` · `POST /users/me:change-password` | （空，任意登录用户） |
| `GET /users*` · `GET /roles*` | `user:view` |
| `POST /users` · `PATCH|POST /users/*` | `user:manage` |
| `DELETE /users/*` | `user:delete` |
| `POST /users/*:assign-role` · `PUT /users/*/permissions` | `user:grant` |
| `POST|PATCH|PUT|DELETE /roles*` | `role:manage` |
| `GET /permissions*` | `user:view` **或** `role:manage` |
| `GET /route-rules*` | `route_rule:view` |
| `POST|PATCH|DELETE /route-rules*` | `route_rule:manage` |

⚠ `/users/me*` 的规则优先级必须高于 `/users*`：后者要 `user:view`，
普通用户查自己会在闸 1 就被 403，到不了服务端的自查分支。

⚠ `/api/v1/auth/*` **故意不设 catch-all**：未枚举路径落到「受管前缀无规则 = 拒绝」。

### 5.1 `/api/v1/platform` 的三面共存

这个前缀下住着三套码，靠 priority 分层。**读上一行要先读下一行**：

| priority | 模式 | 码 |
|---|---|---|
| 940 | `collect-sources/*:test` · `…:browse` · `collect-points/*:write` | `collect:operate` |
| 940 | `point-histories:aggregate` | `collect:view` |
| 932 | `collect-*` · `point-histories*`（GET） | `collect:view` |
| 930 | `collect-*` · `point-histories*`（`*` 方法） | `collect:manage` |
| 920 | `dashboards/*:validate` | `dashboard:view` |
| 915 | `dashboard-projects` 与 `dashboards` 的建删 | `dashboard:manage` |
| 912 | `dashboard*` · `module-types*`（GET） | `dashboard:view` |
| 910 | `dashboard*`（`*` 方法） | `dashboard:edit` |
| 906 / 905 | `ac-models/*:recommend` · `…:predict` | `ac:view` |
| 900 | `/api/v1/platform/*` 按五种方法兜底 | `ac:view` / `ac:manage` |

⚠ 动作端点（含 `:verb`）必须排在前缀兜底之上：`*` 跨斜杠，`dashboard*` 同样
匹配 `…:validate` 的完整路径，排反了就是「只读用户点自检被 403」。

⚠ 两条写兜底用 `*` 方法而不是逐个方法列：漏一种方法它就落到 900 那五条上，
表现是「持 `ac:manage` 的账号能改大屏与采集配置」。

⚠ `:replace-layout` 要的正是 910 那个码，故**不另立规则**——一条判定相同的
窄规则会被冗余自检判成噪音。「没写」不等于「漏了」，由契约测试证明。

## 6. 数据

| 表 | 说明 |
|---|---|
| `auth.auth_users` | 账号。用户名与邮箱**大小写不敏感唯一** |
| `auth.auth_roles` | 角色 |
| `auth.auth_permissions` | 权限码目录（只读面，由种子驱动） |
| `auth.auth_role_permissions` / `auth.auth_user_permissions` | 两张关联表 |
| `auth.auth_route_rules` | 闸 1 的规则表 |
| `auth.auth_audit_logs` | 审计。**写在业务事务内** |

表名带 `auth_` 前缀而 schema 也叫 `auth`，是刻意的冗余：日志与 SQL 里一眼可辨，
比省两个字符值钱。

⚠ `auth_route_rules.permission_codes` 是**码字面量数组而非外键**：闸 1 在每个受保护
请求上都要跑，join 不划算。目录一致性由种子自检与契约测试锁。

## 7. 凭据

系统有**两种**凭据。它们在 `VerifyService._authenticate` 分流，之后收敛成同一个
`Identity`——下游服务不知道调用方用的是哪一种。

### 7.1 账号令牌（access + refresh）

给人和浏览器用。刷新一次即**轮换两枚**，旧刷新令牌进吊销名单；名单命中视为重放
并整体拒绝。名单在 Redis 上，**Redis 不可达时刷新一律失败**（fail-closed）——
放行等于让被盗的刷新令牌在缓存故障期间恢复效力。

⚠ **access token 不可吊销**：名单只在 `consume_refresh` 里查，`decode_access` 不查。
它靠的是 900 秒的短有效期，所以**有效期不许调长**——那等于签一把收不回来的钥匙。

签名密钥支持「主密钥签发 + 密钥集校验」，否则一次轮换就是一次全站强制重新登录。

### 7.2 API 密钥（`dtk_<前缀>_<密钥体>`）

给第三方系统用（ADR-0013）。不过期是允许的，代价是**每次认证都回库判定**吊销、
过期与账号状态——因此吊销立刻生效。

| 事实 | 为什么 |
|---|---|
| 权限**完全**继承所属账号，密钥自身不持有码 | 多一套权限来源就多一处会漂的真源 |
| 明文只在签发响应里出现一次 | 库里只有 argon2id 散列，我们自己也拿不回 |
| 只 `:revoke`，没有 DELETE | 删行等于让「它曾经存在过」从审计里消失 |
| **不能用于本服务的管理面**（`deps.get_identity` 判前缀后拒绝） | 否则被盗的密钥能给自己再签一枚，吊销追不上签发 |
| `expires_in_days` 无默认值，永不过期要显式写 `null` | 它必须是有人主动选的，不能是漏填的结果 |
| 签发/吊销挂 `user:manage` + `assert_target_not_higher` | 与「重置他人密码」同构风险，故同构的闸 |

管理入口在前端 `/system/api-keys`（`web/app/src/pages/System/ApiKeys/`）。
⚠ **前端自己从不使用密钥**，它一律用账号令牌——密钥不过期，落进浏览器就是把
一把长期钥匙交给了 XSS。那一页只负责签发、展示一次明文、吊销。

⚠ 认证路径上有一层按密钥缓存的 argon2 结果（60 秒），因为 `/verify` 是全站前置且
只有 500ms 超时。它缓存的**只是算力结果**，且永远在吊销与过期判定之后才被读到；
Redis 不可达时**退回逐次 argon2 而不是拒绝**——这一层是性能件，让它 fail-closed
等于 Redis 一抖第三方系统就全线写不进值。

## 8. 本地命令

```bash
cd server/services/auth-server
uv run alembic upgrade head     # 建表
uv run python -m scripts.seed   # 写权限码、内置角色、路由规则、种子账号
uv run auth-server              # 起服务（默认 8004）
uv run pytest -q                # 全量测试
```
