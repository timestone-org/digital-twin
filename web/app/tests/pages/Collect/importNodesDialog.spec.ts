/** @fileoverview 浏览批量导入草稿的有界渲染、跨页编辑与全量校验。 */
import { afterEach, describe, expect, it } from 'vitest'
import {
  enableAutoUnmount,
  flushPromises,
  mount,
  type VueWrapper,
} from '@vue/test-utils'
import ImportNodesDialog from '@/pages/Collect/components/ImportNodesDialog.vue'
import ImportDraftRow from '@/pages/Collect/components/ImportDraftRow.vue'
import type { ImportDraft } from '@/pages/Collect/scripts/importDrafts'
import type { CollectPointItemInput } from '@dt/contracts'
import { DtModal, DtNumberInput, DtSelect, DtSwitch } from '@dt/ui'

function drafts(count: number): ImportDraft[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `Point${index}`,
    address: `ns=2;s=Point${index}`,
    code: `point${index}`,
    fieldType: 'float',
  }))
}

enableAutoUnmount(afterEach)

async function render(items: ImportDraft[]) {
  const wrapper = mount(ImportNodesDialog, {
    props: { modelValue: false, drafts: items, takenCodes: new Set<string>() },
    global: { stubs: { teleport: true } },
  })
  await wrapper.setProps({ modelValue: true })
  await flushPromises()
  return wrapper
}

function confirmedItems(wrapper: VueWrapper): CollectPointItemInput[] {
  const items = wrapper.emitted<[CollectPointItemInput[]]>('confirm')?.[0]?.[0]
  if (items === undefined) throw new Error('没有提交点位')
  return items
}

describe('浏览节点导入分页', () => {
  it('统一设置应用到全部草稿，保留现场已确认的类型', async () => {
    const items = drafts(2)
    const first = items[0]
    if (first === undefined) throw new Error('缺少首行')
    first.fieldType = null
    const wrapper = await render(items)
    const numbers = wrapper.findAllComponents(DtNumberInput)
    numbers[0]?.vm.$emit('update:modelValue', 2500)
    numbers[1]?.vm.$emit('update:modelValue', 0.5)
    numbers[2]?.vm.$emit('update:modelValue', 7)
    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'int')
    await flushPromises()
    const confirm = wrapper
      .findAll('button')
      .find((button) => button.text() === '导入 2 个节点')
    await confirm?.trigger('click')
    const submitted = confirmedItems(wrapper)
    expect(submitted[0]).toMatchObject({
      data_type: 'int',
      sampling_interval_ms: 2500,
      deadband: 0.5,
      archive_retention_days: 7,
    })
    expect(submitted[1]?.data_type).toBe('float')
  })

  it('关闭记录历史会清除提交的归档死区与保留期', async () => {
    const wrapper = await render(drafts(1))
    wrapper.findComponent(DtSwitch).vm.$emit('update:modelValue', false)
    await flushPromises()
    const confirm = wrapper
      .findAll('button')
      .find((button) => button.text() === '导入 1 个节点')
    await confirm?.trigger('click')
    expect(
      wrapper.emitted<[CollectPointItemInput[]]>('confirm')?.[0]?.[0]?.[0],
    ).toMatchObject({
      archive_enabled: false,
      deadband: 0,
      archive_retention_days: null,
    })
  })

  it('取消和弹窗关闭只关闭草稿，不提交点位', async () => {
    const wrapper = await render(drafts(1))
    const cancel = wrapper
      .findAll('button')
      .find((button) => button.text() === '取消')
    await cancel?.trigger('click')
    wrapper.findComponent(DtModal).vm.$emit('update:modelValue', false)
    expect(wrapper.emitted('update:modelValue')).toEqual([[false], [false]])
    expect(wrapper.emitted('confirm')).toBeUndefined()
  })

  it('2000 个草稿每次最多挂载 50 行', async () => {
    const wrapper = await render(drafts(2000))
    expect(wrapper.findAllComponents(ImportDraftRow)).toHaveLength(50)
    expect(wrapper.text()).toContain('导入 2000 个节点')
  })

  it('末页编辑保留首屏草稿，确认提交全部 2000 条', async () => {
    const wrapper = await render(drafts(2000))
    const lastPage = wrapper
      .get('nav[aria-label="节点草稿分页"]')
      .findAll('button')
      .find((button) => button.text() === '40')
    if (lastPage === undefined) throw new Error('缺少末页入口')
    await lastPage.trigger('click')
    expect(wrapper.findAllComponents(ImportDraftRow)).toHaveLength(50)
    await wrapper
      .get('input[aria-label="Point1999 的点位编码"]')
      .setValue('tail_edited')
    const confirm = wrapper
      .findAll('button')
      .find((button) => button.text() === '导入 2000 个节点')
    await confirm?.trigger('click')

    const submitted =
      wrapper.emitted<[CollectPointItemInput[]]>('confirm')?.[0]?.[0]
    expect(submitted).toHaveLength(2000)
    expect(submitted?.[0]?.code).toBe('point0')
    expect(submitted?.[1999]?.code).toBe('tail_edited')
  })

  it('隐藏页的编码问题仍阻止整批提交，并能定位到问题页', async () => {
    const items = drafts(120)
    const last = items[119]
    if (last === undefined) throw new Error('缺少末行')
    last.code = ''
    const wrapper = await render(items)
    const confirm = wrapper
      .findAll('button')
      .find((button) => button.text() === '导入 120 个节点')
    expect(confirm?.attributes('disabled')).toBeDefined()
    const locate = wrapper
      .findAll('button')
      .find((button) => button.text() === '定位首个编码问题')
    await locate?.trigger('click')
    expect(
      wrapper.find('input[aria-label="Point119 的点位编码"]').exists(),
    ).toBe(true)
    await wrapper
      .get('input[aria-label="Point119 的点位编码"]')
      .setValue('tail_fixed')
    const ready = wrapper
      .findAll('button')
      .find((button) => button.text() === '导入 120 个节点')
    expect(ready?.attributes('disabled')).toBeUndefined()
    await ready?.trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })
})
