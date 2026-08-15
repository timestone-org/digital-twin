/**
 * @fileoverview 批量建部件面的契约：已认领的节点不可选且说明原因、
 * 全选只选可选项、每次打开清空上一次的勾选、确认上抛选中的节点名。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import BulkPartsDialog from '@/pages/TwinEditor/components/BulkPartsDialog.vue'

const CANDIDATES = [
  { name: 'Pump_01', takenBy: '一号泵' },
  { name: 'Pump_02', takenBy: null },
  { name: 'Tank_A', takenBy: null },
]

function mountDialog(open = true) {
  return mount(BulkPartsDialog, {
    props: { open, candidates: CANDIDATES },
    global: { stubs: { Teleport: true } },
  })
}

/** 勾第 index 个复选框（0 是全选那个）。 */
async function check(
  wrapper: ReturnType<typeof mountDialog>,
  index: number,
): Promise<void> {
  const boxes = wrapper.findAll('input[type="checkbox"]')
  await boxes[index]?.setValue(true)
}

describe('候选列表', () => {
  it('已被认领的节点禁选，并说出被谁占了', () => {
    const wrapper = mountDialog()

    expect(wrapper.text()).toContain('已属于 一号泵')
    const boxes = wrapper.findAll('input[type="checkbox"]')
    // 0 是全选，1 起是候选；第一个候选已被认领
    expect(boxes[1]?.attributes('disabled')).toBeDefined()
    expect(boxes[2]?.attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

  it('全选只覆盖可选项，不碰已认领的', async () => {
    const wrapper = mountDialog()

    await check(wrapper, 0)

    expect(wrapper.text()).toContain('建 2 个部件')
    wrapper.unmount()
  })
})

describe('确认', () => {
  it('上抛选中的节点名并关闭', async () => {
    const wrapper = mountDialog()

    await check(wrapper, 2)
    await wrapper.get('[data-test="bulk-confirm"]').trigger('click')

    expect(wrapper.emitted('confirm')?.[0]).toEqual([['Pump_02']])
    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
    wrapper.unmount()
  })

  it('一个都没选时确认键是禁用的', () => {
    const wrapper = mountDialog()

    const confirm = wrapper.get('[data-test="bulk-confirm"]')
    expect(confirm.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})

describe('重新打开', () => {
  it('清掉上一次的勾选——留着会让人以为没选却建出一堆部件', async () => {
    const wrapper = mountDialog(false)

    await wrapper.setProps({ open: true })
    await check(wrapper, 2)
    expect(wrapper.text()).toContain('建 1 个部件')

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })

    expect(wrapper.text()).toContain('建 0 个部件')
    wrapper.unmount()
  })
})

describe('空态', () => {
  it('模型还没节点时告诉用户先去选模型', () => {
    const wrapper = mount(BulkPartsDialog, {
      props: { open: true, candidates: [] },
      global: { stubs: { Teleport: true } },
    })

    expect(wrapper.text()).toContain('先在「模型与场景」里选一个模型')
    wrapper.unmount()
  })
})
