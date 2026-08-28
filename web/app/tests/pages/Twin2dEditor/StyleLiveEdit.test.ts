/**
 * @fileoverview 契约：改一份样式，**画布上用它的那些节点当场跟着变**——不必重挂、
 * 不必点一下画布、也不必先保存。改内置样式落的是文档里那份同 id 的覆盖，而节点层
 * 解析样式时同 id 以文档为准，两条合起来才是「画布即时」。
 *
 * ⚠ 这条链上任何一环退化成快照（节点层把样式表缓在本地 ref、样式面改完不整份换引用）
 * 都不报错，只表现为「改了没反应，刷一下才对」。所以这里正面断言 `setProps` 之后
 * DOM 就变了，不给「重新挂一次也算」的余地。
 * ⚠ 内置样式那一支要按 id 断言文档里落了一条覆盖：只断言「解析出来的样式变了」的话，
 * 把预置数据整份写进文档的实现照样绿，而那会让预置库将来升级再也修不到这张图（§13.4）。
 */
import { TWIN_2D_BUILTIN_NODE_STYLES, twin2dStyleResolver } from '@dt/twin2d'
import { normalizeTwin2dConfig } from '@dt/twin2d'
import type { Twin2dConfig, Twin2dNodeStyle } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CanvasNodeLayer from '@/pages/Twin2dEditor/components/CanvasNodeLayer.vue'
import { TWIN_2D_DEFAULT_SNAP } from '@/pages/Twin2dEditor/scripts/snapping'
import {
  twin2dNodeStyleOf,
  updateNodeStyle,
} from '@/pages/Twin2dEditor/scripts/styleOps'

/** 夹具坏了要当场炸，不能悄悄退化成一个空样式。 */
function throwMissing(): never {
  throw new Error('夹具没通过归一化')
}

const BUILTIN: Twin2dNodeStyle =
  TWIN_2D_BUILTIN_NODE_STYLES[0] ?? throwMissing()

/**
 * 一份带一行固定文字的样式；那行字就是「画面变没变」的判据。
 * @param text 那一行字
 */
function styleOf(text: string): Twin2dNodeStyle {
  return (
    normalizeTwin2dConfig({
      styles: [
        {
          id: 'st',
          name: '换热器',
          size: { w: 120, h: 80 },
          prims: [{ id: 't1', kind: 'txt', src: { kind: 'lit', text } }],
        },
      ],
    }).styles[0] ?? throwMissing()
  )
}

/** 一个用这份样式的节点。 */
const CONFIG: Twin2dConfig = normalizeTwin2dConfig({
  styles: [styleOf('改之前')],
  nodes: [{ id: 'n1', styleId: 'st', x: 10, y: 10 }],
})

function mountLayer(nodeStyles: readonly Twin2dNodeStyle[]) {
  return mount(CanvasNodeLayer, {
    props: {
      nodes: CONFIG.nodes,
      nodeStyles,
      selectedIds: ['n1'],
      snap: TWIN_2D_DEFAULT_SNAP,
      scale: 1,
      startGesture: () => false,
    },
  })
}

describe('改样式，画布当场跟着变', () => {
  it('换一份新的样式表就重画，不必重挂', async () => {
    const wrapper = mountLayer([styleOf('改之前')])
    expect(wrapper.text()).toContain('改之前')

    await wrapper.setProps({ nodeStyles: [styleOf('改之后')] })

    expect(wrapper.text()).toContain('改之后')
    expect(wrapper.text()).not.toContain('改之前')
  })

  it('选中着的那个节点也照样跟着变', async () => {
    const wrapper = mountLayer([styleOf('改之前')])

    await wrapper.setProps({ nodeStyles: [styleOf('选中也变')] })

    expect(wrapper.text()).toContain('选中也变')
  })
})

describe('改内置样式 = 文档里落一份同 id 的覆盖', () => {
  it('文档里多出一条同 id 的，预置库那份不动', () => {
    const clean = normalizeTwin2dConfig({})
    const next = updateNodeStyle(clean, BUILTIN, { name: '我改的' })

    expect(next.styles.map((style) => style.id)).toEqual([BUILTIN.id])
    expect(TWIN_2D_BUILTIN_NODE_STYLES[0]?.name).toBe(BUILTIN.name)
  })

  it('画布解析样式时同 id 以文档为准，于是那一改立刻画得出来', () => {
    const clean = normalizeTwin2dConfig({})
    const next = updateNodeStyle(clean, BUILTIN, { name: '我改的' })

    expect(twin2dStyleResolver(next)(BUILTIN.id)?.name).toBe('我改的')
    expect(twin2dNodeStyleOf(next, BUILTIN.id)?.name).toBe('我改的')
  })

  it('样式面与画布解析出来的是同一份，不许各查各的表', () => {
    const next = updateNodeStyle(CONFIG, styleOf('改之前'), { name: '同一份' })

    expect(twin2dNodeStyleOf(next, 'st')).toEqual(
      twin2dStyleResolver(next)('st'),
    )
  })
})
