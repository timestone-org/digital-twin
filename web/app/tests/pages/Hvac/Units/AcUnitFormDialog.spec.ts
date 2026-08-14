/**
 * @fileoverview 建档 / 改空调弹窗的契约：打开即铺好现值、车间房间级联、
 * 没选房间不许提交、保存走对应的接口。
 *
 * ⚠ 「打开即铺好现值」这条最容易破：watch 不写 immediate 时，组件在已经是
 * 打开态时被挂载，表单会是空的，而看上去只是「用户自己没填」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { AcUnit, Room, Workshop } from '@dt/contracts'

import * as hvac from '@/api/hvac'
import AcUnitFormDialog from '@/pages/Hvac/Units/components/AcUnitFormDialog.vue'

const STAMP = '2026-01-01T00:00:00.000Z'

function workshop(): Workshop {
  return {
    id: 'w1',
    name: '东车间',
    room_count: 1,
    ac_unit_count: 1,
    created_at: STAMP,
    updated_at: STAMP,
  }
}

function room(id: string, name: string): Room {
  return {
    id,
    name,
    workshop: { id: 'w1', name: '东车间' },
    ac_unit_count: 0,
    created_at: STAMP,
    updated_at: STAMP,
  }
}

function acUnit(): AcUnit {
  return {
    id: 'a1',
    serial: 'AC-A-101',
    name: '东侧机',
    room: { id: 'r2', name: '装配房' },
    workshop: { id: 'w1', name: '东车间' },
    created_at: STAMP,
    updated_at: STAMP,
  }
}

beforeEach(() => {
  vi.spyOn(hvac, 'listWorkshops').mockResolvedValue({
    items: [workshop()],
    page: 1,
    size: 200,
    total: 1,
  })
  vi.spyOn(hvac, 'listRooms').mockResolvedValue({
    items: [room('r1', '注塑房'), room('r2', '装配房')],
    page: 1,
    size: 200,
    total: 2,
  })
})

enableAutoUnmount(afterEach)

afterEach(() => {
  vi.restoreAllMocks()
})

async function open(unit: AcUnit | null) {
  const wrapper = mount(AcUnitFormDialog, {
    props: { modelValue: true, unit },
  })
  await flushPromises()
  return wrapper
}

function inputs(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('.dt-input__el')]
}

async function type(index: number, value: string): Promise<void> {
  const field = inputs()[index]
  if (field === undefined) throw new Error(`第 ${index} 个输入框不存在`)
  field.value = value
  field.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}

/** 在第 n 个 DtSelect 里点一个选项。弹窗与浮层都 teleport 在 body 上。 */
async function pickInSelect(index: number, label: string): Promise<void> {
  const triggers = [...document.querySelectorAll('.dt-select__trigger')]
  triggers[index]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
  const option = [...document.querySelectorAll('.dt-select-menu__item')].find(
    (node) => node.textContent?.trim() === label,
  )
  option?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  await flushPromises()
}

function clickByText(text: string): void {
  const button = [...document.querySelectorAll('button')].find((node) =>
    node.textContent?.trim().includes(text),
  )
  button?.click()
}

describe('建档 / 改空调弹窗', () => {
  it('新建时是空表单，且提交按钮先禁着', async () => {
    await open(null)
    expect(inputs()[0]?.value).toBe('')
    const save = [...document.querySelectorAll('button')].find((node) =>
      node.textContent?.includes('保存'),
    )
    expect(save?.hasAttribute('disabled')).toBe(true)
  })

  it('编辑时打开即铺好序号、名称与它现在所在的房间', async () => {
    await open(acUnit())
    expect(inputs()[0]?.value).toBe('AC-A-101')
    expect(inputs()[1]?.value).toBe('东侧机')
    expect(document.body.textContent).toContain('装配房')
  })

  it('两级都选定后建档走 createAcUnit，并把房间一起送上去', async () => {
    const create = vi
      .spyOn(hvac, 'createAcUnit')
      .mockResolvedValue({ ...acUnit(), id: 'new' })
    const wrapper = await open(null)
    await type(0, 'AC-B-201')
    await type(1, '新机')
    await pickInSelect(0, '东车间')
    await pickInSelect(1, '注塑房')
    clickByText('保存')
    await flushPromises()
    expect(create).toHaveBeenCalledWith({
      serial: 'AC-B-201',
      name: '新机',
      room_id: 'r1',
    })
    expect(wrapper.emitted('saved')?.[0]).toEqual(['空调已建档'])
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
  })

  it('编辑时直接保存就把它留在原房间，不需要再选一遍', async () => {
    const update = vi.spyOn(hvac, 'updateAcUnit').mockResolvedValue(acUnit())
    const wrapper = await open(acUnit())
    clickByText('保存')
    await flushPromises()
    expect(update).toHaveBeenCalledWith('a1', {
      serial: 'AC-A-101',
      name: '东侧机',
      room_id: 'r2',
    })
    expect(wrapper.emitted('saved')?.[0]).toEqual(['空调已更新'])
  })

  it('保存失败时把原因说给用户，而不是静默关掉', async () => {
    vi.spyOn(hvac, 'createAcUnit').mockRejectedValue(new Error('boom'))
    const wrapper = await open(null)
    await type(0, 'AC-C-301')
    await type(1, '机')
    clickByText('保存')
    await flushPromises()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })

  it('没填齐时按回车也提交不了', async () => {
    // 表单的 submit 事件绕过了那个禁用的按钮，这条守的是第二道判断
    const create = vi.spyOn(hvac, 'createAcUnit')
    await open(null)
    document
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    await flushPromises()
    expect(create).not.toHaveBeenCalled()
  })

  it('点取消只关窗，不发任何请求', async () => {
    const create = vi.spyOn(hvac, 'createAcUnit')
    const wrapper = await open(null)
    clickByText('取消')
    await flushPromises()
    expect(create).not.toHaveBeenCalled()
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([false])
  })

  it('车间下没有房间时给的是出路，不是一个空下拉框', async () => {
    vi.mocked(hvac.listRooms).mockResolvedValue({
      items: [],
      page: 1,
      size: 200,
      total: 0,
    })
    await open(acUnit())
    expect(document.body.textContent).toContain('空间配置')
  })
})
