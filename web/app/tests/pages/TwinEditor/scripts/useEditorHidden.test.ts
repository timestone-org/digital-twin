/**
 * @fileoverview 契约：左栏眼睛的显隐只属于本次编辑——换一段孪生就清空，
 * 且永远不写回文档里的「初始可见」。
 */
import { normalizeTwinConfig, type TwinConfig } from '@dt/twin-config'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { describe, expect, it } from 'vitest'

import {
  useEditorHidden,
  type TwinEditorHidden,
} from '@/pages/TwinEditor/scripts/useEditorHidden'

const CONFIG = normalizeTwinConfig({
  anchors: [{ id: 'a1' }, { id: 'a2' }],
})

function mountHidden(config: TwinConfig | null = CONFIG) {
  const scope = ref('d1/n1')
  // ⚠ 存进对象而不是 let：赋值发生在 setup 的闭包里，TS 追不到，
  //   用 let 的话读回来的类型会塌成 never
  const holder: { api: TwinEditorHidden | null } = { api: null }
  const host = defineComponent({
    setup() {
      holder.api = useEditorHidden(
        () => config,
        () => scope.value,
      )
      return () => h('div')
    },
  })
  const wrapper = mount(host)
  const hidden = holder.api
  if (hidden === null) throw new Error('组合式函数没装上')
  return { wrapper, scope, hidden }
}

function visibleIds(config: TwinConfig | null): string[] {
  return (config?.anchors ?? [])
    .filter((item) => item.visibility.visible)
    .map((item) => item.id)
}

describe('useEditorHidden', () => {
  it('没关过眼睛时全都显示', () => {
    const { hidden } = mountHidden()

    expect(visibleIds(hidden.config.value)).toEqual(['a1', 'a2'])
  })

  it('关一个眼睛只藏那一个', () => {
    const { hidden } = mountHidden()

    hidden.toggle({ kind: 'anchors', id: 'a1' })

    expect(visibleIds(hidden.config.value)).toEqual(['a2'])
  })

  it('再点一次又显示出来', () => {
    const { hidden } = mountHidden()

    hidden.toggle({ kind: 'anchors', id: 'a1' })
    hidden.toggle({ kind: 'anchors', id: 'a1' })

    expect(visibleIds(hidden.config.value)).toEqual(['a1', 'a2'])
  })

  // ⚠ 路由复用同一页组件，不清的话上一段孪生藏起来的实体会串到下一段，
  // 表现是「刚打开就有几个东西不见了」，而配置里一个字段都没改
  it('换一段孪生就把隐藏态清空', async () => {
    const { hidden, scope, wrapper } = mountHidden()
    hidden.toggle({ kind: 'anchors', id: 'a1' })

    scope.value = 'd1/n2'
    await wrapper.vm.$nextTick()

    expect(visibleIds(hidden.config.value)).toEqual(['a1', 'a2'])
  })

  it('文档还没读出来时给 null，不造一份空配置', () => {
    const { hidden } = mountHidden(null)

    expect(hidden.config.value).toBeNull()
  })

  // ⚠ 眼睛绝不写回文档：写回去的话「本次编辑先藏起来」会变成保存后的持久设置
  it('原配置一字不动', () => {
    const { hidden } = mountHidden()

    hidden.toggle({ kind: 'anchors', id: 'a1' })

    expect(CONFIG.anchors.every((item) => item.visibility.visible)).toBe(true)
  })
})
