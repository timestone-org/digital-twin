/**
 * @fileoverview 契约：自检弹窗的三态——在查时给转圈、全绿时说得出「可以上线」、
 * 有问题时逐条摆出字段路径与原因。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import type { ValidationReport } from '@/api/dashboard'
import ValidateBindingsDialog from '@/pages/Home/components/ValidateBindingsDialog.vue'

function mountDialog(
  loading: boolean,
  result: ValidationReport | null,
): ReturnType<typeof mount> {
  return mount(ValidateBindingsDialog, {
    props: { open: true, loading, result, dashboardName: '光伏总览' },
    global: { stubs: { Teleport: true } },
  })
}

describe('三态', () => {
  it('在查时给转圈而不是空白', () => {
    const wrapper = mountDialog(true, null)

    expect(wrapper.text()).toContain('检查中')
  })

  it('全绿时说得出可以上线', () => {
    const wrapper = mountDialog(false, {
      dashboardId: 'd1',
      isValid: true,
      issues: [],
    })

    expect(wrapper.text()).toContain('全部引用都能解析')
  })

  it('有问题时逐条摆出字段路径、错误码与原因', () => {
    const wrapper = mountDialog(false, {
      dashboardId: 'd1',
      isValid: false,
      issues: [
        {
          field: 'nodes[2].bindings[0].nodeKey',
          code: 'point_missing',
          message: '点位不存在',
        },
      ],
    })

    expect(wrapper.text()).toContain('有 1 处引用解析不了')
    expect(wrapper.text()).toContain('nodes[2].bindings[0].nodeKey')
    expect(wrapper.text()).toContain('point_missing')
    expect(wrapper.text()).toContain('点位不存在')
  })

  it('还没有结果时说明白，而不是渲染一片空', () => {
    const wrapper = mountDialog(false, null)

    expect(wrapper.text()).toContain('还没有自检结果')
  })
})

describe('关闭', () => {
  it('点关闭抛 update:open(false)', async () => {
    const wrapper = mountDialog(false, null)
    const hit = wrapper
      .findAll('button')
      .find((button) => button.text().includes('关闭'))

    await hit?.trigger('click')

    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })
})

describe('弹窗自带的关闭路径', () => {
  it('点弹窗右上角的关闭键把 update:open(false) 转出去', async () => {
    const wrapper = mountDialog(false, null)

    await wrapper.find('[aria-label="关闭"]').trigger('click')

    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })
})
