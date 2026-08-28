/**
 * @fileoverview 契约：右栏两页的分派，以及批量摆位那一段真的接到了「选中的那一批」上。
 *
 * ⚠ 摆位读的是**整批**、检查器读的是「最后点的那一个」，两条选中不能合成一条：合成
 * 之后总有一边只拿得到另一边要的东西，而界面上只表现为「多选了却没有摆位那一段」。
 * ⚠ 摆位那一段在属性页里：摆到绑定页上的话，正在绑点的人会被一排按不着的键挤掉半栏，
 * 而两页单看都对。
 */
import { normalizeTwin2dConfig } from '@dt/twin2d'
import type { Twin2dConfig } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Twin2dRightPane from '@/pages/Twin2dEditor/components/Twin2dRightPane.vue'
import type { Twin2dPick } from '@/pages/Twin2dEditor/scripts/editorSelection'
import { TWIN_2D_SELECT_CANVAS } from '@/pages/Twin2dEditor/scripts/types'

const CONFIG: Twin2dConfig = normalizeTwin2dConfig({
  canvas: { width: 800, height: 600, grid: 20 },
  styles: [{ id: 's1', name: '方块', size: { w: 40, h: 20 } }],
  nodes: [
    { id: 'a', styleId: 's1', x: 100, y: 40 },
    { id: 'b', styleId: 's1', x: 220, y: 90 },
  ],
})

/**
 * 挂一份右栏。
 * @param pick 画布上选中的那一批
 */
function mountPane(pick: Twin2dPick | null) {
  return mount(Twin2dRightPane, {
    props: {
      config: CONFIG,
      selection: TWIN_2D_SELECT_CANVAS,
      pick,
      styleFocus: null,
      selectedPrim: '',
      bindings: [],
      isDirty: false,
    },
  })
}

type Wrapper = ReturnType<typeof mountPane>

/**
 * 摆位那一段被整页的显隐藏起来了没有。
 * ⚠ 按 `v-show` 落下的行内 `display` 判，不用 `isVisible()`：happy-dom 下后者对组件
 * 根节点恒回 true，于是「两页同时摆着」这种错法照样报绿（同 `index.spec`）。
 * @param wrapper 挂好的右栏
 */
function hiddenByPane(wrapper: Wrapper): boolean {
  const panel = wrapper.find('[data-test="arrange-panel"]')
  if (!panel.exists()) return true
  return panel.element.closest('[style*="display: none"]') !== null
}

/**
 * 切到某一页。
 * @param wrapper 挂好的右栏
 * @param label 页签上的文案
 */
async function switchPane(wrapper: Wrapper, label: string): Promise<void> {
  const tab = wrapper
    .get('[data-test="right-pane-tabs"]')
    .findAll('button')
    .find((item) => item.text() === label)
  await tab?.trigger('click')
}

describe('批量摆位那一段', () => {
  it('选中一批时摆得出来', () => {
    const wrapper = mountPane({ kind: 'nodes', ids: ['a', 'b'] })

    expect(wrapper.find('[data-test="arrange-panel"]').exists()).toBe(true)
  })

  it('只选一个时不占地方', () => {
    const wrapper = mountPane({ kind: 'nodes', ids: ['a'] })

    expect(wrapper.find('[data-test="arrange-panel"]').exists()).toBe(false)
  })

  // ⚠ 摆位改的是整份配置，与检查器走同一条 change：接错的话按了没反应且零报错
  it('摆完的整份配置从右栏原样往上抛', async () => {
    const wrapper = mountPane({ kind: 'nodes', ids: ['a', 'b'] })

    await wrapper.find('[data-test="arrange-align-left"]').trigger('click')

    const events = wrapper.emitted<[Twin2dConfig]>('change') ?? []
    expect(events.at(-1)?.[0].nodes.map((node) => node.x)).toEqual([100, 100])
  })

  // ⚠ 摆到绑定页上的话，正在绑点的人会被一排按不着的键挤掉半栏，而两页单看都对
  it('切到绑定页就跟着让开，切回来再摆出来', async () => {
    const wrapper = mountPane({ kind: 'nodes', ids: ['a', 'b'] })
    expect(hiddenByPane(wrapper)).toBe(false)

    await switchPane(wrapper, '绑定')
    expect(hiddenByPane(wrapper)).toBe(true)

    await switchPane(wrapper, '属性')
    expect(hiddenByPane(wrapper)).toBe(false)
  })
})
