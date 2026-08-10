/**
 * @fileoverview 权限勾选器的契约：覆盖语义、锁定项只读、风险档打标。
 * 三个弹窗共用它，这里错一处等于三处都错。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { PermissionGroup } from '@dt/contracts'

import PermissionCodePicker from '@/features/permissions/PermissionCodePicker.vue'

const GROUPS: PermissionGroup[] = [
  {
    code: 'user',
    label: '用户与角色',
    items: [
      {
        id: 'p1',
        code: 'user:view',
        name: '查看',
        description: null,
        group_code: 'user',
        group_label: '用户与角色',
        sort_order: 10,
        kind: 'view',
        is_builtin: true,
      },
      {
        id: 'p2',
        code: 'user:grant',
        name: '授权',
        description: null,
        group_code: 'user',
        group_label: '用户与角色',
        sort_order: 20,
        kind: 'admin',
        is_builtin: true,
      },
    ],
  },
]

function render(props: Record<string, unknown> = {}) {
  return mount(PermissionCodePicker, {
    props: { groups: GROUPS, modelValue: new Set<string>(), ...props },
  })
}

describe('PermissionCodePicker', () => {
  it('按分组铺开全部码，让人看得见「没勾的会被移除」', () => {
    const wrapper = render()
    expect(wrapper.text()).toContain('用户与角色')
    expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(2)
  })

  it('已选的码是勾上的', () => {
    const boxes = render({
      modelValue: new Set(['user:grant']),
    }).findAll<HTMLInputElement>('input[type="checkbox"]')
    expect(boxes[0]?.element.checked).toBe(false)
    expect(boxes[1]?.element.checked).toBe(true)
  })

  it('勾选抛出的是完整的新集合，不是增量', async () => {
    const wrapper = render({ modelValue: new Set(['user:view']) })
    await wrapper.findAll('input[type="checkbox"]')[1]?.setValue(true)
    const emitted = wrapper.emitted('update:modelValue')?.[0]?.[0]
    expect(emitted).toEqual(new Set(['user:view', 'user:grant']))
  })

  it('取消勾选同样抛完整集合', async () => {
    const wrapper = render({ modelValue: new Set(['user:view', 'user:grant']) })
    await wrapper.findAll('input[type="checkbox"]')[0]?.setValue(false)
    expect(wrapper.emitted('update:modelValue')?.[0]?.[0]).toEqual(
      new Set(['user:grant']),
    )
  })

  it('锁定的码禁用并标注来源，不能被当成直权勾掉', () => {
    const wrapper = render({
      locked: new Set(['user:view']),
      lockedLabel: '角色已含',
    })
    expect(wrapper.findAll('input[type="checkbox"]:disabled')).toHaveLength(1)
    expect(wrapper.text()).toContain('角色已含')
  })

  it('只给风险档打标，view / manage 不打', () => {
    const text = render().text()
    expect(text).toContain('高危')
    expect(text).not.toContain('查看档')
  })
})
