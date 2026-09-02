/**
 * @fileoverview auth-server 的对外类型与权限码字面量。
 * ⚠ 这里的类型手写自 `server/services/auth-server/openapi.json`，一致性由
 * `app/tests/contract/openapi-shapes.test.ts` 逐字段锁死；改接口先改这里。
 */

/** 权限码档位。改一个枚举名不能悄悄改变库里已存的值，故用字符串字面量。 */
export const PERMISSION_KINDS = ['view', 'manage', 'operate', 'admin'] as const
export type PermissionKind = (typeof PERMISSION_KINDS)[number]

/** 已发布的权限码。**只许新增，不许改名。** */
export const PERMISSION_CODES = {
  userView: 'user:view',
  userManage: 'user:manage',
  userDelete: 'user:delete',
  userGrant: 'user:grant',
  roleManage: 'role:manage',
  routeRuleView: 'route_rule:view',
  routeRuleManage: 'route_rule:manage',
  acView: 'ac:view',
  acManage: 'ac:manage',
  opcuaView: 'opcua:view',
  opcuaOperate: 'opcua:operate',
  opcuaManage: 'opcua:manage',
  dashboardView: 'dashboard:view',
  dashboardEdit: 'dashboard:edit',
  dashboardManage: 'dashboard:manage',
  collectView: 'collect:view',
  collectOperate: 'collect:operate',
  collectManage: 'collect:manage',
  assetView: 'asset:view',
  assetManage: 'asset:manage',
  datasetView: 'dataset:view',
  datasetManage: 'dataset:manage',
  datasetRecordWrite: 'dataset:record:write',
  datasetOverride: 'dataset:override',
  datasetBackfill: 'dataset:backfill',
  formulaView: 'formula:view',
  // ⚠ 与 dataset:manage 分家是刻意的：改一条库公式会同时改掉**所有**引用它的
  // 台账列，爆炸半径比改单张表的一列大一个量级（docs/DATASET_DESIGN.md §9）
  formulaManage: 'formula:manage',
  modelingView: 'modeling:view',
  modelingManage: 'modeling:manage',
  // ⚠ 与 manage 分家：一次训练吃满一个核，能改图不等于能随手起一轮
  modelingRun: 'modeling:run',
  // ⚠ 比 run 再严一档：发布出去的版本会被台账公式直接引用，改一次绑定影响的
  // 是**所有**引用那条公式的台账列（docs/MODELING_DESIGN.md §7.7）
  modelingPublish: 'modeling:publish',
  assistantUse: 'assistant:use',
  // ⚠ 比 use 严一档：模型账号是**整套部署共用的一份**，换掉它等于替所有人
  // 换了说话的账号
  assistantManage: 'assistant:manage',
  knowledgeUse: 'knowledge:use',
  knowledgeWrite: 'knowledge:write',
  // ⚠ 比另外两条严：改嵌入档等于让整库的既有向量作废，而那件事没有任何
  // 运行期迹象，只表现为召回忽然全错
  knowledgeManage: 'knowledge:manage',
  llmView: 'llm:view',
  // ⚠ 模型供应商是**整套部署共用的**：一个端点同时喂助手与知识库，改了之后
  // 两边十秒内都改用新端点说话，且密钥会拿去打外部地址（ADR-0039）
  llmManage: 'llm:manage',
} as const

export type PermissionCode =
  (typeof PERMISSION_CODES)[keyof typeof PERMISSION_CODES]

export interface RoleRef {
  id: string
  name: string
  description: string | null
  is_builtin: boolean
}

/** 用户的公共形状：列表项与详情都有这些字段。对应后端 `UserOut`。 */
export interface UserBase {
  id: string
  username: string
  email: string
  full_name: string | null
  avatar_url: string | null
  phone: string | null
  is_active: boolean
  last_login_at: string | null
  created_at: string
  updated_at: string
  role: RoleRef
}

/**
 * 用户列表项（`GET /users`）。对应后端 `UserListItemOut`。
 *
 * ⚠ **没有权限码数组**，只有直权条数——列表不展开权限集。把列表项当详情用
 * 是本仓真踩过的坑：`direct_permissions.length` 取到 undefined 当场把整页崩掉，
 * 而覆盖式写直权的表单会把「空集」当成用户现有的直权提交，静默清空授权。
 * 需要完整权限码就去拉详情（`admin.getUser`）。
 */
export interface UserListItem extends UserBase {
  direct_permission_count: number
}

/** 用户详情（`/users/me`、`/users/{id}` 与所有写操作的回参）。 */
export interface AuthUser extends UserBase {
  role_permissions: string[]
  direct_permissions: string[]
  permissions: string[]
}

export interface TokenPair {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in_s: number
}

export interface SessionResult {
  token: TokenPair
  user: AuthUser
}

export interface PermissionItem {
  id: string
  code: string
  name: string
  description: string | null
  group_code: string
  group_label: string
  sort_order: number
  kind: PermissionKind
  is_builtin: boolean
}

export interface PermissionGroup {
  code: string
  label: string
  items: PermissionItem[]
}

export interface PermissionCatalog {
  items: PermissionItem[]
  groups: PermissionGroup[]
}
