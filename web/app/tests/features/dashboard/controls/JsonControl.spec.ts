/**
 * @fileoverview 契约：JSON 控件实时解析，解不出来时**显式报错且不写回**。
 * ⚠ 静默丢弃用户的输入等于「我改了但没反应」，那是这套系统里最难查的一类故障。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ConfigField } from '@dt/contracts'
import { DtNotice } from '@dt/ui'

import JsonControl from '@/features/dashboard/controls/JsonControl.vue'

const FIELD: ConfigField = { key: 'raw', label: '原始配置', type: 'json' }

function mountJson(value: unknown) {
  return mount(JsonControl, { props: { field: FIELD, value } })
}

/** 最后一次抛出的 `update`。 */
function lastUpdate(wrapper: ReturnType<typeof mountJson>): unknown[] {
  const events = wrapper.emitted('update') ?? []
  return events.at(-1) ?? []
}

describe('显示现值', () => {
  it('当前值序列化进文本域', () => {
    const wrapper = mountJson({ a: [1, 2] })
    const el = wrapper.find('textarea').element

    expect(el.value).toBe(JSON.stringify({ a: [1, 2] }, null, 2))
  })

  it('没配过时是空文本域，不是字面量 undefined', () => {
    const wrapper = mountJson(undefined)

    expect(wrapper.find('textarea').element.value).toBe('')
  })

  it('外部改了值（撤销、换选中节点）就把草稿换回来', async () => {
    const wrapper = mountJson({ a: 1 })

    await wrapper.setProps({ field: FIELD, value: { b: 2 } })

    expect(wrapper.find('textarea').element.value).toContain('"b"')
  })
})

describe('编辑上抛', () => {
  it('合法 JSON 抛解析后的值，且不算连续输入', async () => {
    const wrapper = mountJson({})

    await wrapper.find('textarea').setValue('{ "n": 3 }')

    expect(lastUpdate(wrapper)).toStrictEqual([{ n: 3 }, false])
  })

  it('清空即取消这一项的配置', async () => {
    const wrapper = mountJson({ a: 1 })

    await wrapper.find('textarea').setValue('   ')

    expect(lastUpdate(wrapper)).toStrictEqual([undefined, false])
  })
})

describe('解析失败', () => {
  it('解不出来时不写回，只挂一条错误', async () => {
    const wrapper = mountJson({ a: 1 })

    await wrapper.find('textarea').setValue('{ 坏掉的 json')

    expect(wrapper.emitted('update')).toBeUndefined()
    expect(wrapper.text()).toContain('不是合法的 JSON')
  })

  it('错误画成红态，不混在普通提示里', async () => {
    const wrapper = mountJson({ a: 1 })

    await wrapper.find('textarea').setValue('[')

    expect(wrapper.findComponent(DtNotice).props('intent')).toBe('danger')
  })

  it('改回合法之后照常写回去', async () => {
    const wrapper = mountJson({ a: 1 })

    await wrapper.find('textarea').setValue('[')
    await wrapper.find('textarea').setValue('[1]')

    expect(lastUpdate(wrapper)).toStrictEqual([[1], false])
    expect(wrapper.findComponent(DtNotice).exists()).toBe(false)
  })
})
