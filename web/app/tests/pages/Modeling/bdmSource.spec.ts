/** @fileoverview BDM 目录选择、分页、只读状态与过期请求不覆盖。 */
import type { ModelingBdmCatalog } from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as modeling from '@/api/modeling'
import { BizError } from '@/api/client'
import BdmIdentifierPicker from '@/pages/Modeling/Canvas/components/BdmIdentifierPicker.vue'
import ArrayConfigInput from '@/pages/Modeling/Canvas/components/ArrayConfigInput.vue'
import {
  defaultsOf,
  fieldsOf,
} from '@/pages/Modeling/Canvas/scripts/schemaForm'

const fields = fieldsOf({
  type: 'object',
  required: ['identifiers'],
  properties: {
    identifiers: {
      type: 'array',
      title: '取数标识',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 10,
      'x-dt-widget': 'bdm-identifiers',
    },
  },
})
const field = fields[0]
if (field === undefined) throw new Error('Missing identifiers schema')

function page(
  kind: ModelingBdmCatalog['kind'] = 'point',
  name = '温度',
): ModelingBdmCatalog {
  return {
    kind,
    total: 100,
    page: 1,
    size: 50,
    system_filter_available: false,
    items: [
      {
        identifier: 'p1',
        code: 'P_1',
        name,
        system: null,
        history_available: true,
      },
    ],
  }
}

afterEach(() => vi.restoreAllMocks())

describe('BDM 取数参数', () => {
  it.each(['raw', 'formula'] as const)('%s 目录提供搜索入口', async (kind) => {
    vi.spyOn(modeling, 'listModelingBdmCatalog').mockResolvedValue(page(kind))
    const wrapper = mount(BdmIdentifierPicker, {
      props: { kind, field, modelValue: [], isReadonly: false },
    })
    await flushPromises()
    expect(wrapper.find('.dt-bdm-picker__search input').exists()).toBe(true)
    expect(
      wrapper.findAll('button').some((button) => button.text() === '查询'),
    ).toBe(true)
    wrapper.unmount()
  })

  it('新建节点的标识初值是数组', () => {
    expect(defaultsOf(fields)).toEqual({ identifiers: [] })
  })

  it.each(['raw', 'formula'] as const)(
    '%s 搜索能找到当前页之外的记录',
    async (kind) => {
      const records = Array.from({ length: 201 }, (_, index) => ({
        identifier: `id-${index}`,
        code: `CODE_${index}`,
        name: index === 200 ? '目标温度' : `普通记录 ${index}`,
        system: null,
        history_available: null,
      }))
      vi.spyOn(modeling, 'listModelingBdmCatalog').mockImplementation(
        (query) => {
          const size = query.size ?? 50
          return Promise.resolve({
            kind,
            page: query.page,
            size,
            total: records.length,
            system_filter_available: null,
            items: records.slice((query.page - 1) * size, query.page * size),
          })
        },
      )
      const wrapper = mount(BdmIdentifierPicker, {
        props: { kind, field, modelValue: ['kept'], isReadonly: false },
      })
      await flushPromises()
      expect(wrapper.text()).not.toContain('目标温度')
      await wrapper.get('.dt-bdm-picker__search input').setValue('目标')
      await wrapper
        .findAll('button')
        .find((button) => button.text() === '查询')
        ?.trigger('click')
      await vi.waitFor(() => expect(wrapper.text()).toContain('目标温度'))
      expect(wrapper.findAll('input[type="checkbox"]')).toHaveLength(1)
      await wrapper.get('input[type="checkbox"]').setValue(true)
      expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([
        ['kept', 'id-200'],
      ])
      wrapper.unmount()
    },
  )

  it('从真实目录标识选择并支持手填多个值', async () => {
    const request = vi
      .spyOn(modeling, 'listModelingBdmCatalog')
      .mockResolvedValue(page())
    const wrapper = mount(BdmIdentifierPicker, {
      props: { kind: 'point', field, modelValue: [], isReadonly: false },
    })
    await flushPromises()
    expect(request.mock.calls[0]?.[0]).toEqual({
      kind: 'point',
      page: 1,
      keyword: '',
    })
    expect(wrapper.text()).toContain('温度（P_1）')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['p1']])
    await wrapper.getComponent(ArrayConfigInput).get('input').setValue('p1,p2')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([['p1', 'p2']])
    wrapper.unmount()
  })

  it('翻页保留已选标识且只读时不能修改', async () => {
    const request = vi
      .spyOn(modeling, 'listModelingBdmCatalog')
      .mockResolvedValue(page())
    const wrapper = mount(BdmIdentifierPicker, {
      props: { kind: 'point', field, modelValue: ['p2'], isReadonly: true },
    })
    await flushPromises()
    expect(
      wrapper.get('input[type="checkbox"]').attributes('disabled'),
    ).toBeDefined()
    const next = wrapper
      .findAll('button')
      .find((button) => button.text() === '下一页')
    expect(next).toBeDefined()
    await next?.trigger('click')
    await flushPromises()
    expect(request.mock.calls.at(-1)?.[0].page).toBe(2)
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('快速换类别后旧目录不得覆盖新目录', async () => {
    let resolveOld: (value: ModelingBdmCatalog) => void = () => undefined
    const old = new Promise<ModelingBdmCatalog>((resolve) => {
      resolveOld = resolve
    })
    vi.spyOn(modeling, 'listModelingBdmCatalog')
      .mockReturnValueOnce(old)
      .mockResolvedValueOnce(page('formula', '用电公式'))
    const wrapper = mount(BdmIdentifierPicker, {
      props: { kind: 'point', field, modelValue: [], isReadonly: false },
    })
    await wrapper.setProps({ kind: 'formula' })
    await flushPromises()
    resolveOld(page('point', '过期点位'))
    await flushPromises()
    expect(wrapper.text()).toContain('用电公式')
    expect(wrapper.text()).not.toContain('过期点位')
    wrapper.unmount()
  })

  it('目录请求失败显示错误与重试入口', async () => {
    vi.spyOn(modeling, 'listModelingBdmCatalog').mockRejectedValue(
      new BizError(51401, '目录不可用', 503, 'test-trace'),
    )
    const wrapper = mount(BdmIdentifierPicker, {
      props: { kind: 'raw', field, modelValue: [], isReadonly: false },
    })
    await flushPromises()
    expect(
      wrapper
        .findAll('[role="alert"]')
        .map((item) => item.text())
        .join(' '),
    ).toContain('目录不可用')
    expect(wrapper.text()).toContain('重试目录')
    expect(wrapper.text()).not.toContain('本页没有可选项')
    wrapper.unmount()
  })
})
