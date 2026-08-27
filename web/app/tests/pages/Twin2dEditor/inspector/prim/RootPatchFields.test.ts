/**
 * @fileoverview 契约：节点根覆盖的六格各带一个「覆盖 / 不覆盖」开关，关掉写的是删键。
 *
 * ⚠ 写一个缺省值进去会把样式本来配好的那一格一起按回缺省，而这一步零报错。
 * ⚠ 抬升与等比缩放是同一条位移上的两段，hover 那一档两样都要给。
 */
import type { Twin2dRootPatch } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import RootPatchFields from '@/pages/Twin2dEditor/components/inspector/prim/RootPatchFields.vue'

function mountFields(modelValue: Twin2dRootPatch = {}) {
  return mount(RootPatchFields, { props: { modelValue } })
}

type Wrapper = ReturnType<typeof mountFields>

function lastWrite(wrapper: Wrapper): Twin2dRootPatch {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有写回根覆盖')
  return events[events.length - 1]?.[0] as Twin2dRootPatch
}

/** 六格各自的开关与那一格在补丁里的键。 */
const CELLS = [
  { test: 'root-lift-on', key: 'lift' },
  { test: 'root-scale-on', key: 'scale' },
  { test: 'root-z-on', key: 'z' },
  { test: 'root-border-on', key: 'borderColor' },
  { test: 'root-accent-on', key: 'accent' },
  { test: 'root-shadows-on', key: 'shadows' },
] as const

describe('开关', () => {
  it('六格一格不少', () => {
    const wrapper = mountFields()

    for (const cell of CELLS) {
      expect(
        wrapper.find(`[data-test="${cell.test}"]`).exists(),
        cell.key,
      ).toBe(true)
    }
  })

  it('打开一格就把那个键写进补丁', async () => {
    for (const cell of CELLS) {
      const wrapper = mountFields()

      await wrapper.find(`[data-test="${cell.test}"] input`).setValue(true)

      expect(cell.key in lastWrite(wrapper), cell.key).toBe(true)
    }
  })

  // ⚠ 删键而不是写一个缺省值进去
  it('关掉一格写的是删键', async () => {
    const full: Twin2dRootPatch = {
      lift: 3,
      scale: 1.02,
      z: 30,
      borderColor: 'red',
      accent: 'blue',
      shadows: [],
    }

    for (const cell of CELLS) {
      const wrapper = mountFields(full)

      await wrapper.find(`[data-test="${cell.test}"] input`).setValue(false)

      expect(cell.key in lastWrite(wrapper), cell.key).toBe(false)
    }
  })

  it('没打开的格子不摆控件', () => {
    const wrapper = mountFields()

    expect(wrapper.find('[data-test="root-lift"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="root-shadows"]').exists()).toBe(false)
  })
})

describe('取值', () => {
  it('抬升与层号可正可负', async () => {
    const wrapper = mountFields({ lift: 3, z: 30 })

    await wrapper.find('[data-test="root-lift"]').setValue('-2')
    expect(lastWrite(wrapper).lift).toBe(-2)

    await wrapper.find('[data-test="root-z"]').setValue('-1')
    expect(lastWrite(wrapper).z).toBe(-1)
  })

  // ⚠ ≤0 的等比缩放会被归一化整键丢掉，用户看到的是「填了没生效」
  it('等比缩放夹在正数', async () => {
    const wrapper = mountFields({ scale: 1.02 })

    await wrapper.find('[data-test="root-scale"]').setValue('0')

    expect(lastWrite(wrapper).scale).toBeGreaterThan(0)
  })

  it('两处颜色经消毒', async () => {
    const wrapper = mountFields({ borderColor: 'red' })

    await wrapper
      .find('[data-test="root-border"] .dt-color__text input')
      .setValue('url(a.png)')

    expect(lastWrite(wrapper).borderColor).toBe('currentColor')
  })

  it('阴影表整份换', async () => {
    const wrapper = mountFields({ shadows: [] })

    await wrapper
      .find('[data-test="root-shadows"] [data-test="shadow-add"]')
      .trigger('click')

    expect(lastWrite(wrapper).shadows).toHaveLength(1)
  })

  // ⚠ 空表 = 不覆盖阴影，要去掉外发光得给一条透明阴影
  it('阴影空表那一句说明摆在面上', () => {
    expect(mountFields({ shadows: [] }).text()).toContain('给一条透明阴影')
  })

  it('抬升与缩放是一条位移上两段这件事写在面上', () => {
    expect(mountFields({ lift: 3 }).text()).toContain('两样都要给')
  })
})

describe('合并撤销的出口', () => {
  it('失焦转出一次 blur', async () => {
    const wrapper = mountFields({ lift: 3 })

    await wrapper.find('[data-test="root-lift"]').trigger('focusout')

    expect(wrapper.emitted('blur')).toHaveLength(1)
  })
})
