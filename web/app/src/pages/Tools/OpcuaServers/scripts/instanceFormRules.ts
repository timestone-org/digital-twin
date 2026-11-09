/**
 * @fileoverview 实例表单的字段规则，与 opcua-server `schemas/instance.py` 同口径。
 * 前端先拦一道，是为了把「参数校验失败」这句笼统的 400 换成指到字段上的话。
 */
import type { OpcuaSecurityPolicy } from '@dt/contracts'

const NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/

export interface InstanceFormFields {
  name: string
  endpointPath: string
  namespaceUri: string
  policies: readonly OpcuaSecurityPolicy[]
}

export interface InstanceFieldErrors {
  name?: string
  endpointPath?: string
  namespaceUri?: string
  policies?: string
}

/** 新建时名称的不合规原因；合规给 undefined。@param value 名称 */
function nameProblem(value: string): string | undefined {
  const name = value.trim()
  if (name === '') return '请填写名称'
  if (name.length > 64) return '名称不能超过 64 个字符'
  if (!NAME_PATTERN.test(name))
    return '名称须以字母开头，只能含字母、数字、下划线与短横'
  return undefined
}

/** 端点路径的不合规原因。@param value 端点路径 */
function pathProblem(value: string): string | undefined {
  const path = value.trim()
  if (!path.startsWith('/')) return '端点路径须以 / 开头，如 /digitaltwin'
  if (path.length > 128) return '端点路径不能超过 128 个字符'
  return undefined
}

/** 命名空间 URI 的不合规原因。@param value 命名空间 URI */
function namespaceProblem(value: string): string | undefined {
  const uri = value.trim()
  if (uri === '') return '请填写命名空间 URI'
  if (uri.length > 255) return '命名空间 URI 不能超过 255 个字符'
  return undefined
}

/**
 * 逐个字段给出不合规原因；全合规给空对象。
 * @param fields 表单取值
 * @param isEdit 编辑态不校验名称（名称不可改）
 */
export function instanceFieldErrors(
  fields: InstanceFormFields,
  isEdit: boolean,
): InstanceFieldErrors {
  const errors: InstanceFieldErrors = {}
  const name = isEdit ? undefined : nameProblem(fields.name)
  const endpointPath = pathProblem(fields.endpointPath)
  const namespaceUri = namespaceProblem(fields.namespaceUri)
  if (name !== undefined) errors.name = name
  if (endpointPath !== undefined) errors.endpointPath = endpointPath
  if (namespaceUri !== undefined) errors.namespaceUri = namespaceUri
  if (fields.policies.length === 0) errors.policies = '至少勾选一种安全策略'
  return errors
}

/** 新建时按名称给的默认命名空间 URI。@param name 实例名称 */
export function defaultNamespaceUri(name: string): string {
  const trimmed = name.trim()
  return trimmed === '' ? '' : `urn:digitaltwin:${trimmed}`
}
