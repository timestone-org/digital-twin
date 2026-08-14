/**
 * @fileoverview 守取数源的注入接缝：未装配的子树拿到**诚实空源**（每条绑定都说
 * 「没有装配取数源」而不是静默留白），装配过的子树拿到应用壳那份读取器。
 */
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'

import type { BindingValueReader } from '../src/moduleValues'
import {
  emptyRuntimeData,
  provideRuntimeData,
  useRuntimeData,
} from '../src/runtimeData'
import { fakeBinding } from '../src/testing/fixtures'

const BINDING = fakeBinding({
  id: 'b1',
  fieldKey: 'power',
  sourceKind: 'opcua',
})

/**
 * 把读到的槽渲染成一行文字，供用例断言。
 * ⚠ 必须是宿主的**子组件**：`inject` 看的是父链，同一个组件里 provide 完再 inject 取不到。
 */
const Probe = {
  name: 'RuntimeDataProbe',
  setup() {
    const slot = useRuntimeData().readBinding()(BINDING, {})
    const text = slot.state === 'error' ? slot.message : slot.state
    return () => h('i', { class: 'probe' }, text)
  },
}

function mountProbe(reader?: BindingValueReader) {
  const Host = defineComponent({
    name: 'RuntimeDataHost',
    setup() {
      if (reader !== undefined)
        provideRuntimeData({ readBinding: () => reader })
      return () => h(Probe)
    },
  })
  return mount(Host)
}

describe('取数源的注入', () => {
  it('没装配时每条绑定都说得出为什么读不到', () => {
    expect(mountProbe().get('.probe').text()).toBe('没有装配取数源')
  })

  it('装配之后走应用壳那份读取器', () => {
    const wrapper = mountProbe(() => ({ state: 'ok', value: 42 }))

    expect(wrapper.get('.probe').text()).toBe('ok')
  })

  it('诚实空源本身就是一个可直接调用的读取器', () => {
    const slot = emptyRuntimeData().readBinding()(BINDING, {})

    expect(slot).toEqual({ state: 'error', message: '没有装配取数源' })
  })
})
