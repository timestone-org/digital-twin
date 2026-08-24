/**
 * @fileoverview 契约：图层树按缩进列节点，选中 / 显隐 / 删除 / 层序 / 重命名 /
 * 换父各抛各的事件。
 * ⚠ 三条静默的坑由这里钉住：行的 key 用节点 id（用索引删中间一层会整体错位）、
 * 输入法组合期的回车不许当成提交（否则改名「改了没生效」）、
 * 拖进自己的子树不许放行（会造出一个环，排版的递归转不出来）。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'

import { layoutFrames } from '@/features/dashboard/editorLayout'
import LayerTree from '@/pages/DashboardEditor/components/LayerTree.vue'

function manifest(over: Partial<ModuleManifest> = {}): ModuleManifest {
  return {
    type: 'demo',
    displayName: '演示模块',
    category: '演示',
    icon: 'building',
    defaultSize: { width: 10, height: 10 },
    configSchema: [],
    bindings: [],
    component: () => Promise.resolve({ default: {} }),
    ...over,
  }
}

const LEAF = manifest()
const BOX = manifest({ type: 'box', displayName: '容器', isContainer: true })

function getManifest(moduleType: string): ModuleManifest | undefined {
  if (moduleType === 'demo') return LEAF
  if (moduleType === 'box') return BOX
  return undefined
}

function node(
  id: string,
  over: Partial<DashboardNodePayload> = {},
): DashboardNodePayload {
  return {
    id,
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: 'demo',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    zIndex: 0,
    isVisible: true,
    configJson: {},
    createdAt: '',
    updatedAt: '',
    bindings: [],
    ...over,
  }
}

function mountTree(
  nodes: DashboardNodePayload[],
  selectedIds: readonly string[] = [],
) {
  return mount(LayerTree, {
    props: {
      frames: layoutFrames(nodes, getManifest).frames,
      nodes,
      selectedIds,
      getManifest,
    },
  })
}

function rowsOf(wrapper: ReturnType<typeof mountTree>) {
  return wrapper.findAll('[data-test="layer-row"]')
}

function buttonBy(wrapper: ReturnType<typeof mountTree>, label: string) {
  return wrapper
    .findAll('button')
    .find((item) => item.attributes('aria-label') === label)
}

/** 手工造拖拽事件：happy-dom 的 DragEvent 构造不收 dataTransfer 与坐标。 */
function fireDrag(
  element: Element,
  type: string,
  extra: Record<string, unknown> = {},
): void {
  const event = new Event(type, { bubbles: true, cancelable: true })
  const transfer = { setData: () => undefined, effectAllowed: '' }
  for (const [key, value] of Object.entries({
    dataTransfer: transfer,
    ...extra,
  })) {
    Object.defineProperty(event, key, { value, configurable: true })
  }
  element.dispatchEvent(event)
}

/** happy-dom 的布局全是 0，行高得自己钉出来才谈得上上半 / 中部 / 下半。 */
function stubRow(element: Element): void {
  Object.defineProperty(element, 'getBoundingClientRect', {
    value: () => ({ top: 0, height: 30 }),
    configurable: true,
  })
}

describe('渲染', () => {
  it('顶层与子层都列出来，显示名取自清单', () => {
    const wrapper = mountTree([node('a'), node('kid', { parentId: 'a' })])

    expect(rowsOf(wrapper)).toHaveLength(2)
    expect(wrapper.text()).toContain('演示模块')
  })

  it('认不出清单时退回模块类型，不留白', () => {
    const wrapper = mountTree([node('a', { moduleType: 'unknown-type' })])

    expect(wrapper.text()).toContain('unknown-type')
  })

  it('用户改过的别名盖过清单显示名', () => {
    const wrapper = mountTree([
      node('a', { configJson: { __label: '左上角标题' } }),
    ])

    expect(wrapper.text()).toContain('左上角标题')
  })

  it('子层比父层多缩进一档', () => {
    const wrapper = mountTree([node('a'), node('kid', { parentId: 'a' })])
    const rows = rowsOf(wrapper)

    expect(rows[0]?.attributes('style')).toContain('6px')
    expect(rows[1]?.attributes('style')).toContain('18px')
  })

  it('选中的那些行都挂上选中样式', () => {
    const wrapper = mountTree([node('a'), node('b', { zIndex: 1 })], ['a', 'b'])

    expect(rowsOf(wrapper)[0]?.classes()).toContain('dt-layer__row--on')
    expect(rowsOf(wrapper)[1]?.classes()).toContain('dt-layer__row--on')
  })

  it('祖先被隐藏的行整行变淡', () => {
    const wrapper = mountTree([
      node('a', { isVisible: false }),
      node('kid', { parentId: 'a' }),
    ])

    expect(rowsOf(wrapper)[1]?.classes()).toContain('dt-layer__row--dim')
  })

  it('行内每个图标键都真的画出了图标', () => {
    const wrapper = mountTree([node('a')])
    const labels = ['定位到此节点', '在编辑画布隐藏这个节点', '删除这个节点']

    for (const label of labels) {
      expect(buttonBy(wrapper, label)?.find('.dt-icon').exists()).toBe(true)
    }
  })

  it('折叠一层后它的整棵子树都不再出现', async () => {
    const wrapper = mountTree([node('a'), node('kid', { parentId: 'a' })])

    await buttonBy(wrapper, '折叠子层')?.trigger('click')

    expect(rowsOf(wrapper)).toHaveLength(1)
    expect(buttonBy(wrapper, '展开子层')?.exists()).toBe(true)
  })
})

describe('选中与行内动作', () => {
  it('点一行抛 select，不累积', async () => {
    const wrapper = mountTree([node('a')])

    await rowsOf(wrapper)[0]?.trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual(['a', false])
  })

  it('Shift 点一行抛的是累积多选', async () => {
    const wrapper = mountTree([node('a')])

    await rowsOf(wrapper)[0]?.trigger('click', { shiftKey: true })

    expect(wrapper.emitted('select')?.[0]).toEqual(['a', true])
  })

  it('切设计态显隐只抛节点 id', async () => {
    const wrapper = mountTree([node('a')])

    await buttonBy(wrapper, '在编辑画布隐藏这个节点')?.trigger('click')

    expect(wrapper.emitted('toggleEditorVisible')?.[0]).toEqual(['a'])
  })

  it('已隐藏的节点给的是「显示」这一档', async () => {
    const wrapper = mountTree([node('a', { isVisible: false })])

    await buttonBy(wrapper, '在编辑画布显示这个节点')?.trigger('click')

    expect(wrapper.emitted('toggleEditorVisible')?.[0]).toEqual(['a'])
  })

  it('删除抛 remove，且不顺带选中它', async () => {
    const wrapper = mountTree([node('a')])

    await buttonBy(wrapper, '删除这个节点')?.trigger('click')

    expect(wrapper.emitted('remove')?.[0]).toEqual(['a'])
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('居中抛 center', async () => {
    const wrapper = mountTree([node('a')])

    await buttonBy(wrapper, '定位到此节点')?.trigger('click')

    expect(wrapper.emitted('center')?.[0]).toEqual(['a'])
  })

  // 动作键挂在会整行选中的行元素里，漏掉 .stop 的表现是「点显隐顺带换了选区」
  it('定位与切显隐都不顺带选中那一行', async () => {
    const wrapper = mountTree([node('a')])

    await buttonBy(wrapper, '定位到此节点')?.trigger('click')
    await buttonBy(wrapper, '在编辑画布隐藏这个节点')?.trigger('click')

    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('行内动作键走 DtButton 的 xs 幽灵档，删除键是 danger 色', () => {
    const wrapper = mountTree([node('a')])
    const labels = ['定位到此节点', '在编辑画布隐藏这个节点', '删除这个节点']

    for (const label of labels) {
      const button = buttonBy(wrapper, label)
      expect(button?.classes()).toContain('dt-btn--xs')
      expect(button?.classes()).toContain('dt-btn--ghost')
      expect(button?.classes()).toContain('dt-layer__act')
    }
    expect(buttonBy(wrapper, '删除这个节点')?.attributes('style')).toContain(
      '--state-danger',
    )
  })

  // 已隐藏节点的显隐键是当前状态的唯一提示：不能跟着静息隐藏，且要用警示色标出来
  it('已隐藏的节点显隐键常显（--pinned）并转 warning 色', () => {
    const hidden = mountTree([node('a', { isVisible: false })])
    const shown = mountTree([node('a')])

    const pinned = buttonBy(hidden, '在编辑画布显示这个节点')
    expect(pinned?.classes()).toContain('dt-layer__act--pinned')
    expect(pinned?.attributes('style')).toContain('--state-warning')

    const resting = buttonBy(shown, '在编辑画布隐藏这个节点')
    expect(resting?.classes()).not.toContain('dt-layer__act--pinned')
    expect(resting?.attributes('style')).toContain('--text-secondary')
  })

  // 层序键从行里挪进了右栏「通用配置」：15rem 的左栏摆不下第四、第五个键，
  // 摆下了就没有地方显示节点名与模块类型
  it('行里不再有置顶 / 置底键', () => {
    const wrapper = mountTree([node('a')])

    expect(buttonBy(wrapper, '置顶')).toBeUndefined()
    expect(buttonBy(wrapper, '置底')).toBeUndefined()
  })

  it('行上显示节点名与模块类型', () => {
    const wrapper = mountTree([node('a')])

    expect(rowsOf(wrapper)[0]?.text()).toContain('demo')
  })
})

describe('重命名', () => {
  async function startRename(nodes: DashboardNodePayload[]) {
    const wrapper = mountTree(nodes)
    await wrapper.find('span[title]').trigger('dblclick')
    return { wrapper, input: wrapper.find('.dt-input__el') }
  }

  it('双击名字进入行内改名，回车提交', async () => {
    const { wrapper, input } = await startRename([node('a')])

    await input.setValue('北区总览')
    await input.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('rename')?.[0]).toEqual(['a', '北区总览'])
  })

  it('失焦也算提交', async () => {
    const { wrapper, input } = await startRename([node('a')])

    await input.setValue('北区总览')
    await input.trigger('blur')

    expect(wrapper.emitted('rename')?.[0]).toEqual(['a', '北区总览'])
  })

  it('输入法组合期的回车只是确认候选词，不提交', async () => {
    const { wrapper, input } = await startRename([node('a')])

    await input.setValue('bei')
    await input.trigger('compositionstart')
    await input.trigger('keydown', { key: 'Enter' })
    await input.trigger('blur')

    expect(wrapper.emitted('rename')).toBeUndefined()
  })

  it('组合结束后的回车才落地', async () => {
    const { wrapper, input } = await startRename([node('a')])

    await input.trigger('compositionstart')
    await input.trigger('compositionend')
    await input.setValue('北区')
    await input.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('rename')?.[0]).toEqual(['a', '北区'])
  })

  it('Esc 放弃改名，一个字都不写回', async () => {
    const { wrapper, input } = await startRename([node('a')])

    await input.setValue('半路改的')
    await input.trigger('keydown', { key: 'Escape' })

    expect(wrapper.emitted('rename')).toBeUndefined()
    expect(wrapper.find('.dt-input__el').exists()).toBe(false)
  })
})

describe('拖拽换父与排序', () => {
  // 树是倒序列的：rows[0] 是 z 最大的那个（'b'），rows[1] 才是 'a'
  it('拖到某行上半 = 盖住它', () => {
    const wrapper = mountTree([node('a'), node('b', { zIndex: 1 })])
    const rows = rowsOf(wrapper)
    const target = rows[0]?.element
    if (target === undefined) throw new Error('缺少目标行')
    stubRow(target)

    fireDrag(rows[1]?.element as Element, 'dragstart')
    fireDrag(target, 'drop', { clientY: 2 })

    expect(wrapper.emitted('move')?.[0]).toEqual(['a', null, 1])
  })

  it('拖到某行下半 = 被它压住', () => {
    const wrapper = mountTree([node('a'), node('b', { zIndex: 1 })])
    const rows = rowsOf(wrapper)
    const target = rows[0]?.element
    if (target === undefined) throw new Error('缺少目标行')
    stubRow(target)

    fireDrag(rows[1]?.element as Element, 'dragstart')
    fireDrag(target, 'drop', { clientY: 28 })

    expect(wrapper.emitted('move')?.[0]).toEqual(['a', null, 0])
  })

  it('拖到容器行中部 = 放进容器', () => {
    const wrapper = mountTree([
      node('box', { moduleType: 'box', zIndex: 1 }),
      node('a'),
    ])
    const rows = rowsOf(wrapper)
    const target = rows[0]?.element
    if (target === undefined) throw new Error('缺少目标行')
    stubRow(target)

    fireDrag(rows[1]?.element as Element, 'dragstart')
    fireDrag(target, 'drop', { clientY: 15 })

    expect(wrapper.emitted('move')?.[0]).toEqual(['a', 'box'])
  })

  it('不许拖进自己的子树', () => {
    const wrapper = mountTree([
      node('box', { moduleType: 'box' }),
      node('kid', { parentId: 'box' }),
    ])
    const rows = rowsOf(wrapper)
    const target = rows[1]?.element
    if (target === undefined) throw new Error('缺少目标行')
    stubRow(target)

    fireDrag(rows[0]?.element as Element, 'dragstart')
    fireDrag(target, 'dragover', { clientY: 2 })
    fireDrag(target, 'drop', { clientY: 2 })

    expect(wrapper.emitted('move')).toBeUndefined()
  })

  it('拖到底部落区 = 移出容器回到顶层', () => {
    const wrapper = mountTree([
      node('box', { moduleType: 'box' }),
      node('kid', { parentId: 'box' }),
    ])

    fireDrag(rowsOf(wrapper)[1]?.element as Element, 'dragstart')
    fireDrag(wrapper.find('[data-test="layer-root-drop"]').element, 'drop')

    expect(wrapper.emitted('move')?.[0]).toEqual(['kid', null])
  })
})
