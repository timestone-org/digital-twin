/**
 * @fileoverview 渲染宿主的联动接线契约：配了规则才有可点击外观、
 * 整块可点由宿主统一上抛、子组件上抛原样转发、无引擎时一切缺席。
 */
import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import {
  defineComponent,
  h,
  provide,
  type PropType,
  type SetupContext,
} from 'vue'
import type { InteractionRule, ModuleManifest, ModuleMeta } from '@dt/contracts'

import ModuleRenderer from '../src/ModuleRenderer.vue'
import {
  INTERACTION_KEY,
  createInteractionRuntime,
} from '../src/interactionRuntime'

let lastMeta: ModuleMeta | undefined

const Probe = defineComponent({
  props: {
    config: { type: Object, required: false, default: undefined },
    values: { type: Object, required: false, default: undefined },
    meta: {
      type: Object as PropType<ModuleMeta>,
      required: false,
      default: undefined,
    },
  },
  emits: ['interaction'],
  setup(props, { emit }) {
    return () => {
      lastMeta = props.meta
      return h(
        'button',
        {
          class: 'probe-btn',
          onClick: (event: MouseEvent) => {
            event.stopPropagation()
            emit('interaction', { event: 'click', value: 'row-1' })
          },
        },
        '子项',
      )
    }
  },
})

function manifestOf(over: Partial<ModuleManifest> = {}): ModuleManifest {
  return {
    type: 'probe',
    displayName: '探针',
    category: '测试',
    defaultSize: { width: 100, height: 100 },
    configSchema: [],
    bindings: [],
    emitsInteractions: true,
    component: () => Promise.resolve({ default: Probe }),
    ...over,
  }
}

function clickRule(action: InteractionRule['action']): InteractionRule {
  return { id: 'r', source: { nodeId: 'n1', event: 'click' }, action }
}

async function mountWith(
  manifest: ModuleManifest,
  rules: InteractionRule[] | null,
) {
  const runtime = rules === null ? null : createInteractionRuntime()
  runtime?.init(rules ?? [], [
    { nodeId: 'n1', isVisible: true },
    { nodeId: 'target', isVisible: true },
  ])
  // 宿主只做 provide，直接把选项对象交给 mount：一份夹具不值得再定义一个组件
  const wrapper = mount(
    {
      setup(_props: Record<string, never>, { slots }: SetupContext) {
        if (runtime !== null) provide(INTERACTION_KEY, runtime)
        return () => slots.default?.()
      },
    },
    {
      slots: {
        default: () =>
          h(ModuleRenderer, {
            moduleType: 'probe',
            nodeId: 'n1',
            getManifest: () => manifest,
          }),
      },
    },
  )
  await flushPromises()
  await vi.waitFor(() => {
    expect(wrapper.find('.probe-btn').exists()).toBe(true)
  })
  return { wrapper, runtime }
}

describe('可点击外观', () => {
  it('配了规则才有 interactive 与 role=button', async () => {
    const { wrapper } = await mountWith(manifestOf({ hostClickable: true }), [
      clickRule({ type: 'toggle', targets: ['target'] }),
    ])

    expect(lastMeta?.interactive).toBe(true)
    expect(wrapper.get('.dt-module').attributes('role')).toBe('button')
    wrapper.unmount()
  })

  it('没配规则时不摆可点击外观', async () => {
    const { wrapper } = await mountWith(manifestOf({ hostClickable: true }), [])

    expect(lastMeta?.interactive).toBe(false)
    expect(wrapper.get('.dt-module').attributes('role')).toBeUndefined()
    wrapper.unmount()
  })

  it('无引擎时 interactive 缺席——设计态不该看到可点击外观', async () => {
    const { wrapper } = await mountWith(
      manifestOf({ hostClickable: true }),
      null,
    )

    expect(lastMeta?.interactive).toBeUndefined()
    expect(wrapper.get('.dt-module').attributes('role')).toBeUndefined()
    wrapper.unmount()
  })
})

describe('事件转发', () => {
  it('子项上抛带值转发给引擎', async () => {
    const { wrapper, runtime } = await mountWith(manifestOf(), [
      clickRule({ type: 'hide', targets: ['target'] }),
    ])
    expect(runtime?.isVisible('target')).toBe(true)

    await wrapper.get('.probe-btn').trigger('click')

    expect(runtime?.isVisible('target')).toBe(false)
    wrapper.unmount()
  })

  it('整块可点：宿主点击与键盘都上抛 click', async () => {
    const { wrapper, runtime } = await mountWith(
      manifestOf({ hostClickable: true }),
      [clickRule({ type: 'toggle', targets: ['target'] })],
    )

    await wrapper.get('.dt-module').trigger('click')
    expect(runtime?.isVisible('target')).toBe(false)

    await wrapper.get('.dt-module').trigger('keydown', { key: 'Enter' })
    expect(runtime?.isVisible('target')).toBe(true)
    wrapper.unmount()
  })

  it('子项吞掉冒泡后宿主不再兜底捕获——toggle 不会自我抵消', async () => {
    const { wrapper, runtime } = await mountWith(
      manifestOf({ hostClickable: true }),
      [clickRule({ type: 'toggle', targets: ['target'] })],
    )

    await wrapper.get('.probe-btn').trigger('click')

    // 只 toggle 了一次：可见性从 true 变 false，而不是抵消回 true
    expect(runtime?.isVisible('target')).toBe(false)
    wrapper.unmount()
  })
})
