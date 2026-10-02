/**
 * @fileoverview 模型签名的长文本显示与完整内容提示。
 */
import type { ModelingSignatureInput } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SignatureTable from '@/pages/Modeling/Models/components/SignatureTable.vue'

const INPUT: ModelingSignatureInput = {
  key: `sensor_feature_${'K'.repeat(48)}`,
  label: `模型输入列${'L'.repeat(64)}`,
  unit: 'milligrams_per_cubic_meter',
  dtype: 'float64',
  is_required: false,
  default_on_missing: 123456789012345,
  training_stats: {},
}

describe('模型签名长文本', () => {
  it('定宽列保留完整提示并截断名称、标识、类型、单位和缺省值', () => {
    const wrapper = mount(SignatureTable, { props: { rows: [INPUT] } })
    const cells = wrapper.findAll('tbody td')
    const values = [
      INPUT.label,
      INPUT.key,
      INPUT.dtype,
      INPUT.unit,
      `可缺省 → ${INPUT.default_on_missing}`,
    ]

    for (const [index, text] of values.entries()) {
      const cell = cells[index]
      expect(cell, `缺少第 ${index + 1} 列`).toBeDefined()
      const content = cell?.find('[title]')
      expect(content?.exists()).toBe(true)
      expect(content?.text()).toBe(text)
      expect(content?.attributes('title')).toBe(text)
      expect(content?.classes()).toEqual(
        expect.arrayContaining(['block', 'truncate']),
      )
    }
    wrapper.unmount()
  })

  it('必填徽标和缺失单位继续可读', () => {
    const wrapper = mount(SignatureTable, {
      props: { rows: [{ ...INPUT, is_required: true, unit: '' }] },
    })
    expect(wrapper.text()).toContain('必填')
    expect(wrapper.findAll('tbody td')[3]?.text()).toBe('—')
    wrapper.unmount()
  })
})
