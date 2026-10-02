/**
 * @fileoverview 数据源表单的校验与请求体组装。纯函数，不认识任何控件。
 *
 * ⚠ 口令三态必须一路带到请求体：不填 = 整个字段都不带（不动）、填了 = 改成新的、
 * 勾「清空」= 显式 `null`。合成两态的话，每次改端点都会顺手把口令抹掉。
 * ⚠ 新建时 `null` 一律省略成 `undefined`：三态只在编辑时才有意义，新建时发一个
 * 显式 null 会被后端当成「明确要求置空」。
 */
import { COLLECT_MIN_INTERVAL_MS } from '@dt/contracts'
import type {
  CollectProtocol,
  CollectSourceCreateInput,
  CollectSourceUpdateInput,
} from '@dt/contracts'

import { mergeOptions } from './sourceFormOptions'

/** 编码只能用字母数字与 . _ -，且以字母或数字开头。它是数据源的身份。 */
const CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** 表单此刻的原始取值，与控件一一对应。 */
export interface SourceFormValues {
  protocol: CollectProtocol
  name: string
  code: string
  description: string
  endpoint: string
  securityMode: string
  securityPolicy: string
  readMode: 'poll' | 'subscribe'
  pollIntervalMs: number
  username: string
  /** 空串 = 这次不改口令。 */
  credential: string
  /** 勾上表示把已存的口令删掉。 */
  isCredentialCleared: boolean
  isEnabled: boolean
  extraOptions: Record<string, string>
}

/**
 * 校验一遍，返回第一条不合格的原因；都合格给 null。
 * @param values 表单取值
 * @param isEdit 编辑态（编码不可改，因此不校验）
 */
export function validateSourceForm(
  values: SourceFormValues,
  isEdit: boolean,
): string | null {
  if (values.name.trim() === '') return '请填写名称'
  if (!isEdit && !CODE_PATTERN.test(values.code.trim()))
    return '编码只能用字母、数字与 . _ -，且以字母或数字开头'
  if (values.endpoint.trim() === '') return '请填写 Endpoint 地址'
  const securityError = validateSecurity(values)
  if (securityError !== null) return securityError
  const endpointError = validateEndpoint(values.endpoint, values.protocol)
  if (endpointError !== null) return endpointError
  return validatePollInterval(values)
}

function validateSecurity(values: SourceFormValues): string | null {
  if (
    values.protocol === 'opcua' &&
    (values.securityMode !== 'None' || values.securityPolicy !== 'None')
  )
    return '当前采集驱动尚不支持证书安全连接，请先确认设备的安全要求'
  return null
}

function validatePollInterval(values: SourceFormValues): string | null {
  if (values.pollIntervalMs < COLLECT_MIN_INTERVAL_MS)
    return `轮询周期不能小于 ${COLLECT_MIN_INTERVAL_MS} 毫秒`
  if (values.protocol === 'modbus_tcp' && values.pollIntervalMs < 1000)
    return 'Modbus TCP 的轮询周期不能小于 1000 毫秒'
  return null
}

/** 空白当成没填。 */
function trimmed(value: string): string | null {
  return value.trim() === '' ? null : value.trim()
}

function shared(values: SourceFormValues) {
  const options =
    values.protocol === 'opcua'
      ? mergeOptions(
          values.extraOptions,
          values.securityMode,
          values.securityPolicy,
        )
      : values.extraOptions
  return {
    name: values.name.trim(),
    description: trimmed(values.description),
    endpoint: values.endpoint.trim(),
    username: trimmed(values.username),
    options_json: options,
    read_mode: values.readMode,
    poll_interval_ms: values.pollIntervalMs,
    is_enabled: values.isEnabled,
  }
}

/**
 * 新建请求体。
 * @param values 表单取值
 */
export function toCreateInput(
  values: SourceFormValues,
): CollectSourceCreateInput {
  const base = shared(values)
  return {
    ...base,
    code: values.code.trim(),
    protocol: values.protocol,
    description: base.description ?? undefined,
    username: base.username ?? undefined,
    credential: values.credential === '' ? undefined : values.credential,
  }
}

/**
 * 更新请求体。口令不动时整个字段都不出现。
 * @param values 表单取值
 */
export function toUpdateInput(
  values: SourceFormValues,
): CollectSourceUpdateInput {
  if (values.isCredentialCleared) return { ...shared(values), credential: null }
  if (values.credential !== '')
    return { ...shared(values), credential: values.credential }
  return shared(values)
}

function validateEndpoint(
  value: string,
  protocol: CollectProtocol,
): string | null {
  try {
    const endpoint = new URL(value.trim())
    const expected = protocol === 'opcua' ? 'opc.tcp:' : 'modbus.tcp:'
    if (
      endpoint.protocol !== expected ||
      !endpoint.hostname ||
      endpoint.username ||
      endpoint.password
    )
      return protocol === 'opcua'
        ? '请填写 opc.tcp://主机:端口 格式的地址，账户和口令在下方填写'
        : '请填写 modbus.tcp://主机:端口 格式的地址'
  } catch {
    return 'Endpoint 地址格式不正确'
  }
  return null
}
