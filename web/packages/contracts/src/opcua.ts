/**
 * @fileoverview opcua-server 的出入参类型，逐字对应
 * `server/services/opcua-server/openapi.json`。
 *
 * ⚠ 手写的类型比真接口宽松时，页面会崩在渲染里而 typecheck / lint / 单测全绿。
 * 每个出参类型都被 `app/tests/contract/opcua-shapes.contract.spec.ts` 钉在
 * openapi 上，改后端字段名会在那里红，不会等到线上。
 */

/** 安全策略。与后端 `SecurityPolicy` 的字面量集合一致。 */
export const OPCUA_SECURITY_POLICIES = [
  'NoSecurity',
  'Basic256Sha256_Sign',
  'Basic256Sha256_SignAndEncrypt',
  'Aes128Sha256RsaOaep_Sign',
  'Aes128Sha256RsaOaep_SignAndEncrypt',
  'Aes256Sha256RsaPss_Sign',
  'Aes256Sha256RsaPss_SignAndEncrypt',
] as const
export type OpcuaSecurityPolicy = (typeof OPCUA_SECURITY_POLICIES)[number]

/** 节点数据类型。 */
export const OPCUA_DATA_TYPES = [
  'boolean',
  'sbyte',
  'byte',
  'int16',
  'uint16',
  'int32',
  'uint32',
  'int64',
  'uint64',
  'float',
  'double',
  'string',
  'datetime',
  'guid',
  'byte_string',
] as const
export type OpcuaDataType = (typeof OPCUA_DATA_TYPES)[number]

/**
 * 节点类别。
 * ⚠ `method` 后端会拒——方法节点要绑定 Python 回调，本服务没有可绑的用户代码。
 * 它留在联合里是因为契约上存在，表单必须显式不给这个选项。
 */
export const OPCUA_NODE_CLASSES = [
  'object',
  'variable',
  'property',
  'method',
] as const
export type OpcuaNodeClass = (typeof OPCUA_NODE_CLASSES)[number]

/** 可创建的节点类别——把后端会拒的 `method` 排除在表单之外。 */
export const OPCUA_CREATABLE_NODE_CLASSES = [
  'object',
  'variable',
  'property',
] as const
export type OpcuaCreatableNodeClass =
  (typeof OPCUA_CREATABLE_NODE_CLASSES)[number]

/** 标识的种类。命名空间索引由服务端钉死为 2，不在契约里。 */
export const OPCUA_IDENTIFIER_KINDS = ['numeric', 'string'] as const
export type OpcuaIdentifierKind = (typeof OPCUA_IDENTIFIER_KINDS)[number]

/** 期望状态。⚠ 这是**期望**不是实况，实际在跑与否看 `is_running`。 */
export const OPCUA_DESIRED_STATES = ['running', 'stopped'] as const
export type OpcuaDesiredState = (typeof OPCUA_DESIRED_STATES)[number]

/** 服务器证书的展示面。私钥只在挂载卷上，永远不出现在契约里。 */
export interface OpcuaCertificate {
  fingerprint: string | null
  subject: string | null
  expires_at: string | null
}

/**
 * 一台 OPC UA 服务器实例。
 * ⚠ `desired_state` 与 `is_running` 是两回事：前者是用户按下的意图，
 * 后者以本地监听端口的实况为准。两者不一致时以 `is_running` 为准展示。
 */
export interface OpcuaInstance {
  id: string
  name: string
  description: string | null
  endpoint_path: string
  endpoint_url: string
  port: number
  namespace_uri: string
  security_policies: OpcuaSecurityPolicy[]
  is_anonymous_allowed: boolean
  is_autostart: boolean
  desired_state: OpcuaDesiredState
  is_running: boolean
  /** 有已保存但要重启才生效的改动。 */
  has_pending_restart: boolean
  /** 具体哪些字段尚未生效。⚠ 照实显示，吞掉它就是静默失效。 */
  pending_fields: string[]
  certificate: OpcuaCertificate
  node_count: number
  session_count: number
  created_at: string
  updated_at: string
}

/** 起停动作的回执。只回状态，不回完整实例。 */
export interface OpcuaInstanceAction {
  id: string
  endpoint_url: string
  desired_state: OpcuaDesiredState
  is_running: boolean
}

/** 端口池占用情况。池是部署期常量，用尽即拒绝建实例。 */
export interface OpcuaPortPool {
  total: number
  used: number
  available: number
  instance_count: number
  max_instances: number
  /**
   * 池内当前没被占的端口，升序。建实例时可以从中点名一个。
   * ⚠ 只能从这里挑：池外的端口没有容器映射，上位机连不上，
   * 而实例状态会显示「运行中」。
   */
  free_ports: number[]
}

/** 地址空间里的一个节点。 */
export interface OpcuaNode {
  id: string
  instance_id: string
  parent_id: string | null
  node_class: OpcuaNodeClass
  /** 由人指定、实例内唯一、**永不自动改写**。 */
  identifier: string
  identifier_kind: OpcuaIdentifierKind
  /** 完整 NodeId，形如 `ns=2;s=<identifier>`。 */
  node_id: string
  browse_name: string
  data_type: OpcuaDataType | null
  value_rank: number
  array_dimensions: number[] | null
  access_level: number
  initial_value: unknown
  description: string | null
  created_at: string
  updated_at: string
}

/** 节点增删改的回执，带上本次未生效的字段。 */
export interface OpcuaNodeMutation {
  node: OpcuaNode
  pending_fields: string[]
}

/**
 * 一次取值的结果。
 * ⚠ `is_live=false` 表示实例没在跑，取到的是库里的初值而不是运行态的当前值。
 */
export interface OpcuaNodeValue {
  node_id: string
  identifier: string
  data_type: OpcuaDataType | null
  value: unknown
  is_live: boolean
}

/** 写值的回执。 */
export interface OpcuaNodeWrite {
  node_id: string
  identifier: string
  value: unknown
}

/**
 * 一条在线会话。
 * ⚠ 契约里**没有令牌类型**字段——上位机用的是匿名、用户名还是证书，
 * 当前接口不给。要展示得先扩后端。
 */
export interface OpcuaSession {
  session_id: string
  peer: string
  username: string | null
  connected_at: string
}

/** 上位机接入凭据。库里只有哈希，明文不在这里。 */
export interface OpcuaCredential {
  id: string
  instance_id: string
  username: string
  created_at: string
}

/**
 * 新建凭据的回执。
 * ⚠ `password` **只在这一次返回**，之后任何接口都取不到。页面必须让用户
 * 当场抄走，关掉就再也拿不回来。
 */
export interface OpcuaCredentialCreated {
  credential: OpcuaCredential
  password: string
}

/** X509 信任白名单里的一张证书。公钥不是秘密，可以展示。 */
export interface OpcuaTrustedCertificate {
  id: string
  instance_id: string
  fingerprint: string
  subject: string
  expires_at: string | null
  created_at: string
}

/* ---------------- 入参 ---------------- */

export interface OpcuaInstanceCreateInput {
  name: string
  namespace_uri: string
  security_policies: OpcuaSecurityPolicy[]
  description?: string | null
  endpoint_path?: string
  is_anonymous_allowed?: boolean
  is_autostart?: boolean
  /**
   * 点名一个端口。省略即由服务端从池里挑。
   * ⚠ 必须是 `OpcuaPortPool.free_ports` 里的值——池外或已占用的端口后端会以
   * 42113 拒绝，页面**不许**自作主张换一个：那会把明确的拒绝变成沉默的错。
   */
  port?: number | null
}

export interface OpcuaInstanceUpdateInput {
  description?: string | null
  endpoint_path?: string | null
  namespace_uri?: string | null
  security_policies?: OpcuaSecurityPolicy[] | null
  is_anonymous_allowed?: boolean | null
  is_autostart?: boolean | null
}

export interface OpcuaNodeCreateInput {
  identifier: string
  browse_name: string
  node_class?: OpcuaCreatableNodeClass
  identifier_kind?: OpcuaIdentifierKind
  parent_id?: string | null
  data_type?: OpcuaDataType | null
  value_rank?: number
  array_dimensions?: number[] | null
  access_level?: number
  initial_value?: unknown
  description?: string | null
}

/** ⚠ 没有 `value_rank` 与 `identifier`：前者建后不可改，后者永不改写。 */
export interface OpcuaNodeUpdateInput {
  browse_name?: string | null
  data_type?: OpcuaDataType | null
  access_level?: number | null
  initial_value?: unknown
  description?: string | null
}
