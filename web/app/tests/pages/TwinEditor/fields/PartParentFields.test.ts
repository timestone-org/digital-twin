/**
 * @fileoverview 契约：部件从属一节——上级候选里挡掉环、子件清单、以及两条
 * 「配了看不出来」的提醒。
 *
 * ⚠ 环在下拉里就该配不出来：诊断那几条是给手改 JSON 与导入配置兜底的，
 * 不是主路径。
 */
import type { DtSelectOption } from '@dt/contracts'
import { normalizeTwinConfig } from '@dt/twin-config'
import type { TwinPart } from '@dt/twin-config'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import PartParentFields from '@/pages/TwinEditor/components/fields/PartParentFields.vue'

function partsOf(raw: Record<string, unknown>[]): TwinPart[] {
  return normalizeTwinConfig({ parts: raw }).parts
}

const UNIT = partsOf([
  { id: 'unit', name: '机组', click: { near: 'detail' } },
  { id: 'air', name: '主机', parentId: 'unit' },
  { id: 'rotor', name: '转子', parentId: 'air' },
  { id: 'lonely', name: '独立件' },
])

function partNamed(parts: readonly TwinPart[], id: string): TwinPart {
  const part = parts.find((item) => item.id === id)
  if (part === undefined) throw new Error(`没有部件 ${id}`)
  return part
}

function mountFields(modelValue: TwinPart, parts: readonly TwinPart[] = UNIT) {
  return mount(PartParentFields, { props: { modelValue, parts } })
}

function optionValues(wrapper: ReturnType<typeof mountFields>): string[] {
  const options: readonly DtSelectOption[] = wrapper
    .findComponent(DtSelect)
    .props('options')
  return options.map((option) => option.value)
}

describe('上级候选', () => {
  it('顶层那一档永远在，排在最前', () => {
    expect(optionValues(mountFields(partNamed(UNIT, 'lonely')))[0]).toBe('')
  })

  // ⚠ 列上自己就能一键配出自指，而那要走到诊断才看得见
  it('不列自己', () => {
    expect(optionValues(mountFields(partNamed(UNIT, 'unit')))).not.toContain(
      'unit',
    )
  })

  it('不列自己的后代——挂过去就成环了', () => {
    const values = optionValues(mountFields(partNamed(UNIT, 'unit')))

    expect(values).not.toContain('air')
    expect(values).not.toContain('rotor')
  })

  it('别的部件都在候选里', () => {
    expect(optionValues(mountFields(partNamed(UNIT, 'unit')))).toContain(
      'lonely',
    )
  })

  it('挑一个上级时整份写回部件', async () => {
    const wrapper = mountFields(partNamed(UNIT, 'lonely'))

    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'unit')
    await wrapper.vm.$nextTick()

    const events = wrapper.emitted('update:modelValue')
    expect((events?.[0]?.[0] as TwinPart).parentId).toBe('unit')
  })
})

describe('子件清单', () => {
  it('列出直接子件，点一下抛出它的 id', async () => {
    const wrapper = mountFields(partNamed(UNIT, 'unit'))

    await wrapper.find('[data-test="part-child-air"]').trigger('click')

    expect(wrapper.emitted('selectPart')).toEqual([['air']])
  })

  it('只列直接子件，不把孙件一起摊平', () => {
    const wrapper = mountFields(partNamed(UNIT, 'unit'))

    expect(wrapper.find('[data-test="part-child-rotor"]').exists()).toBe(false)
  })

  it('没有子件时说清楚怎么挂', () => {
    expect(mountFields(partNamed(UNIT, 'lonely')).text()).toContain(
      '还没有部件挂在它下面',
    )
  })
})

describe('两条提醒', () => {
  it('上级指到不存在的部件时说出来', () => {
    const parts = partsOf([{ id: 'a', parentId: 'ghost' }])

    expect(mountFields(partNamed(parts, 'a'), parts).text()).toContain(
      '找不到部件 ghost',
    )
  })

  // 收着子件却不弹详情：装配栏在运行态根本点不出来
  it('收着子件、自己却不弹详情时说出来', () => {
    const parts = partsOf([
      { id: 'unit', name: '机组' },
      { id: 'air', name: '主机', parentId: 'unit' },
    ])

    expect(mountFields(partNamed(parts, 'unit'), parts).text()).toContain(
      '装配栏在运行态点不出来',
    )
  })

  it('自己弹详情就不提醒', () => {
    expect(mountFields(partNamed(UNIT, 'unit')).text()).not.toContain(
      '装配栏在运行态点不出来',
    )
  })
})
