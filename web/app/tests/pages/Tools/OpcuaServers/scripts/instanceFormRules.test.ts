/** @fileoverview 实例表单字段规则与 opcua-server 的约束同口径。 */
import { expect, it } from 'vitest'
import {
  defaultNamespaceUri,
  instanceFieldErrors,
} from '@/pages/Tools/OpcuaServers/scripts/instanceFormRules'

const VALID = {
  name: 'plant',
  endpointPath: '/digitaltwin',
  namespaceUri: 'urn:dt',
  policies: ['NoSecurity' as const],
}

it('合规取值没有错误', () => {
  expect(instanceFieldErrors(VALID, false)).toEqual({})
})

it.each([
  ['', '请填写名称'],
  ['1plant', '名称须以字母开头'],
  ['中文名', '名称须以字母开头'],
  ['a'.repeat(65), '64'],
])('名称 %s 不合规', (name, message) => {
  expect(instanceFieldErrors({ ...VALID, name }, false).name).toContain(message)
})

it('编辑态不校验名称', () => {
  expect(instanceFieldErrors({ ...VALID, name: '' }, true)).toEqual({})
})

it('端点路径须以 / 开头，命名空间与安全策略必填', () => {
  const errors = instanceFieldErrors(
    { ...VALID, endpointPath: 'dt', namespaceUri: ' ', policies: [] },
    false,
  )
  expect(errors.endpointPath).toContain('/')
  expect(errors.namespaceUri).toBe('请填写命名空间 URI')
  expect(errors.policies).toBe('至少勾选一种安全策略')
})

it('默认命名空间按名称生成，名称空着就留空', () => {
  expect(defaultNamespaceUri(' plant ')).toBe('urn:digitaltwin:plant')
  expect(defaultNamespaceUri('')).toBe('')
})
