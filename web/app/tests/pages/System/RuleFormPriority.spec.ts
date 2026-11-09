/** @fileoverview 路由规则表单：优先级留空或写了非整数时就地拦下，不能悄悄存成 0。 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

import * as admin from '@/api/admin'
import * as authApi from '@/api/auth'
import { __resetPermissionCatalog } from '@/features/permissions/usePermissionCatalog'
import RuleFormDialog from '@/pages/System/RouteRules/components/RuleFormDialog.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  document.body.innerHTML = ''
  __resetPermissionCatalog()
  vi.spyOn(authApi, 'fetchPermissionCatalog').mockResolvedValue({
    items: [],
    groups: [],
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** 新建时优先级默认 500，按这个值认出那一格。 */
function priorityInput(): HTMLInputElement {
  const input = [...document.querySelectorAll('input')].find(
    (one) => one.value === '500',
  )
  if (input === undefined) throw new Error('找不到优先级输入框')
  return input
}

describe('RuleFormDialog 的优先级校验', () => {
  it.each(['', '  ', 'abc', '1.5', '-3'])(
    '优先级为 %j 时不提交并说清楚',
    async (raw) => {
      const create = vi.spyOn(admin, 'createRouteRule')
      mount(RuleFormDialog, { props: { modelValue: true, rule: null } })
      await flushPromises()
      const input = priorityInput()
      input.value = raw
      input.dispatchEvent(new Event('input'))
      await flushPromises()
      ;[...document.querySelectorAll('button')]
        .find((b) => b.textContent?.includes('保存'))
        ?.click()
      await flushPromises()
      expect(create).not.toHaveBeenCalled()
      expect(document.body.textContent).toContain('优先级要填非负整数')
    },
  )
})
