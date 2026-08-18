/**
 * @fileoverview 守嵌套字段的条件显示：数组行内与对象子表单里的 `when`，判的都是
 * **本行/本块自己**的取值。
 * ⚠ 漏判的表现是「声明写了、面板照摆」：一个只该在某一档出现的字段哪一档都出现，
 * 而 typecheck 与 lint 双双放行，只能靠这道闸。
 */
import type { ConfigField } from '@dt/contracts'
import { __resetConfigControls } from '@dt/modules'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import { installConfigControls } from '@/features/dashboard/configControls'
import ConfigFieldControl from '@/features/dashboard/controls/ConfigFieldControl.vue'

/** 行内：只有「开关量」那一档才摆真值文案。 */
const KIND: ConfigField = {
  key: 'kind',
  label: '类型',
  type: 'enum',
  default: 'number',
  options: [
    { value: 'number', label: '数值' },
    { value: 'boolean', label: '开关量' },
  ],
}

const TRUE_TEXT: ConfigField = {
  key: 'trueText',
  label: '真值文案',
  type: 'string',
  default: '运行',
  when: { key: 'kind', in: ['boolean'] },
}

const ARRAY_FIELD: ConfigField = {
  key: 'items',
  label: '指标',
  type: 'array',
  itemSchema: [KIND, TRUE_TEXT],
}

const OBJECT_FIELD: ConfigField = {
  key: 'block',
  label: '块',
  type: 'object',
  fields: [KIND, TRUE_TEXT],
}

function labels(wrapper: ReturnType<typeof mount>): string[] {
  return wrapper.findAll('.dt-field__label').map((node) => node.text())
}

function mountField(field: ConfigField, value: unknown) {
  return mount(ConfigFieldControl, { props: { field, value, depth: 0 } })
}

beforeEach(() => {
  __resetConfigControls()
  installConfigControls()
})

describe('数组行内的条件显示', () => {
  it('条件没满足的那一行不摆这个字段', () => {
    const wrapper = mountField(ARRAY_FIELD, [{ kind: 'number' }])

    expect(labels(wrapper)).toEqual(['类型'])
  })

  it('条件满足的那一行才摆', () => {
    const wrapper = mountField(ARRAY_FIELD, [{ kind: 'boolean' }])

    expect(labels(wrapper)).toEqual(['类型', '真值文案'])
  })

  it('判的是各行自己的取值，不是整块配置——两行可以各摆各的', () => {
    const wrapper = mountField(ARRAY_FIELD, [
      { kind: 'number' },
      { kind: 'boolean' },
    ])

    expect(labels(wrapper)).toEqual(['类型', '类型', '真值文案'])
  })

  it('没填过的行按声明缺省判，不是按「什么都没有」判', () => {
    const wrapper = mountField(ARRAY_FIELD, [{}])

    expect(labels(wrapper)).toEqual(['类型'])
  })
})

describe('对象子表单的条件显示', () => {
  it('条件没满足时不摆', () => {
    const wrapper = mountField(OBJECT_FIELD, { kind: 'number' })

    expect(labels(wrapper)).toEqual(['类型'])
  })

  it('条件满足时才摆', () => {
    const wrapper = mountField(OBJECT_FIELD, { kind: 'boolean' })

    expect(labels(wrapper)).toEqual(['类型', '真值文案'])
  })
})
