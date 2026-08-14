/**
 * @fileoverview 契约：未解析绑定弹窗把条数与逐条明细都摆出来，两个去向
 * （去预览 / 留在此页）各抛各的事件——静默丢绑定会让人以为导进来的是能用的屏。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { UnresolvedBinding } from '@dt/contracts'

import UnresolvedBindingsDialog from '@/pages/Home/components/UnresolvedBindingsDialog.vue'

const LIST: UnresolvedBinding[] = [
  {
    nodeKey: 'src-1:PV.P',
    fieldKey: 'value',
    sourceKind: 'opcua',
    reason: '点位不存在',
  },
  {
    nodeKey: 'src-1:PV.Q',
    fieldKey: 'rows[0].value',
    sourceKind: 'archive',
    reason: '台账未登记',
  },
]

function mountDialog(list: UnresolvedBinding[] = LIST) {
  return mount(UnresolvedBindingsDialog, {
    props: {
      open: true,
      count: list.length,
      list,
      dashboardName: '光伏总览',
    },
    global: { stubs: { Teleport: true } },
  })
}

async function clickText(
  wrapper: ReturnType<typeof mountDialog>,
  label: string,
): Promise<void> {
  const hit = wrapper
    .findAll('button')
    .find((button) => button.text().includes(label))
  expect(hit, `没有文案含「${label}」的按钮`).toBeDefined()
  await hit?.trigger('click')
}

describe('明细', () => {
  it('说清绑定是保留了而不是丢了，并给出条数与屏名', () => {
    const wrapper = mountDialog()

    expect(wrapper.text()).toContain('有 2 条绑定')
    expect(wrapper.text()).toContain('绑定按原样保留了')
    expect(wrapper.text()).toContain('光伏总览')
  })

  it('逐条列出槽键、点位身份与原因', () => {
    const wrapper = mountDialog()

    expect(wrapper.text()).toContain('rows[0].value')
    expect(wrapper.text()).toContain('src-1:PV.P')
    expect(wrapper.text()).toContain('台账未登记')
  })

  it('明细为空时只留总述，不渲染空列表框', () => {
    const wrapper = mountDialog([])

    expect(wrapper.find('.dt-unresolved').exists()).toBe(false)
  })
})

describe('两个去向', () => {
  it('点去预览抛 preview', async () => {
    const wrapper = mountDialog()

    await clickText(wrapper, '去预览')

    expect(wrapper.emitted('preview')).toHaveLength(1)
  })

  it('点留在此页抛 dismiss', async () => {
    const wrapper = mountDialog()

    await clickText(wrapper, '留在此页')

    expect(wrapper.emitted('dismiss')).toHaveLength(1)
  })
})

describe('弹窗自带的关闭路径', () => {
  it('点弹窗右上角的关闭键把 update:open(false) 转出去', async () => {
    const wrapper = mountDialog()

    await wrapper.find('[aria-label="关闭"]').trigger('click')

    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })
})
