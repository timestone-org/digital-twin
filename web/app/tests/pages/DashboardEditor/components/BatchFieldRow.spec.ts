/**
 * @fileoverview 契约：批量表单的一行——控件按注册表派发、一改抛
 * `config([key], 值, 连续)`；混合时挂「混合」徽标，布尔/枚举控件仍显示主选中的值、
 * 其余控件显示为空（undefined）。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ConfigField } from '@dt/contracts'
import { __resetConfigControls } from '@dt/modules'

import type { BatchFieldState } from '@/features/dashboard/batchConfig'
import { installConfigControls } from '@/features/dashboard/configControls'
import ConfigFieldControl from '@/features/dashboard/controls/ConfigFieldControl.vue'
import BatchFieldRow from '@/pages/DashboardEditor/components/BatchFieldRow.vue'

function field(
  over: Partial<ConfigField> & Pick<ConfigField, 'type'>,
): ConfigField {
  return { key: 'demo', label: '演示字段', ...over }
}

function state(over: Partial<BatchFieldState> = {}): BatchFieldState {
  return {
    field: field({ type: 'string' }),
    value: '主值',
    isMixed: false,
    ...over,
  }
}

function mountRow(current: BatchFieldState) {
  return mount(BatchFieldRow, { props: { state: current } })
}

beforeEach(() => {
  __resetConfigControls()
  installConfigControls()
})

describe('批量字段行', () => {
  it('画出标签与控件，控件吃主选中的值', () => {
    const wrapper = mountRow(state())

    expect(wrapper.text()).toContain('演示字段')
    expect(wrapper.findComponent(ConfigFieldControl).props('value')).toBe(
      '主值',
    )
  })

  it('一改抛 config([键], 值, 连续标记)', async () => {
    const wrapper = mountRow(state())

    await wrapper.find('.dt-input__el').setValue('统一值')

    expect(wrapper.emitted('config')?.at(-1)).toEqual([
      ['demo'],
      '统一值',
      true,
    ])
  })

  it('不混合时没有「混合」徽标', () => {
    expect(mountRow(state()).find('[data-test="batch-mixed"]').exists()).toBe(
      false,
    )
  })

  it('混合时挂「混合」徽标，文本控件显示为空', () => {
    const wrapper = mountRow(state({ isMixed: true }))

    expect(wrapper.find('[data-test="batch-mixed"]').text()).toContain('混合')
    expect(
      wrapper.findComponent(ConfigFieldControl).props('value'),
    ).toBeUndefined()
  })

  it('混合的布尔与枚举控件摆不出「空」，仍显示主选中的值', () => {
    const boolRow = mountRow(
      state({ field: field({ type: 'boolean' }), value: true, isMixed: true }),
    )
    const enumRow = mountRow(
      state({
        field: field({
          type: 'enum',
          options: [
            { value: 'a', label: '甲' },
            { value: 'b', label: '乙' },
          ],
        }),
        value: 'b',
        isMixed: true,
      }),
    )

    expect(boolRow.findComponent(ConfigFieldControl).props('value')).toBe(true)
    expect(enumRow.findComponent(ConfigFieldControl).props('value')).toBe('b')
  })

  it('字段的 help 说明照常画出来', () => {
    const wrapper = mountRow(
      state({ field: field({ type: 'string', help: '批量改会写到全体' }) }),
    )

    expect(wrapper.text()).toContain('批量改会写到全体')
  })
})
