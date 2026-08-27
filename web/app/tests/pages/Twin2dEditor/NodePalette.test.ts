/**
 * @fileoverview 契约：样式库调色板——预置库与文档里的自建样式合并显示（同 id 以
 * 文档为准且仍站在原位），每一项画的是**真实缩略图**而不是占位方块，拖出去的载荷
 * 走自定义 MIME 且就是样式 id。
 *
 * ⚠ 同 id 另起一栏放「我改过的」会让同一个符号在库里出现两次，而两处点下去得到的
 * 是同一个 styleId。
 * ⚠ 缩略图画成占位方块的话，「这个样式长什么样」就被推给用户去试——而库里有十九种。
 * ⚠ 载荷走 text/plain 会让从别处拖进来的任意文本都被当成一次「新建节点」尝试。
 */
import { TWIN_2D_BUILTIN_NODE_STYLES } from '@dt/twin2d'
import type { Twin2dNodeStyle } from '@dt/twin2d'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import NodePalette from '@/pages/Twin2dEditor/components/NodePalette.vue'
import { TWIN_2D_STYLE_DRAG_MIME } from '@/pages/Twin2dEditor/scripts/paletteDrag'

/** 一份自建样式：预置库里没有这个 id。 */
const OWN: Twin2dNodeStyle = {
  ...(TWIN_2D_BUILTIN_NODE_STYLES[0] ?? throwMissing()),
  id: 'my-pump',
  name: '我的水泵',
  category: 'pump',
}

/** 一份压着内置 id 的覆盖：名字换过，位置不该动。 */
const OVERRIDE: Twin2dNodeStyle = {
  ...(TWIN_2D_BUILTIN_NODE_STYLES[0] ?? throwMissing()),
  name: '改过的余热',
}

/** 夹具坏了要当场炸，不能悄悄退化成一个空样式。 */
function throwMissing(): never {
  throw new Error('预置库是空的')
}

function mountPalette(styles: readonly Twin2dNodeStyle[] = []) {
  return mount(NodePalette, { props: { styles } })
}

type Wrapper = ReturnType<typeof mountPalette>

/** 一项。 */
function item(wrapper: Wrapper, id: string) {
  return wrapper.get(`[data-test="palette-item-${id}"]`)
}

/** 一项缩略图里那层缩放盒的倍率。 */
function zoomOf(wrapper: Wrapper, id: string): number {
  const style = item(wrapper, id).get('.t2p-fit').attributes('style') ?? ''
  const found = /scale\(([\d.]+)\)/.exec(style)
  if (found === null) throw new Error(`${id} 的缩略图没有缩放`)
  return Number(found[1])
}

describe('库里有什么', () => {
  it('预置库整份都摆得出来', () => {
    const wrapper = mountPalette()

    expect(wrapper.findAll('[data-test^="palette-item-"]')).toHaveLength(
      TWIN_2D_BUILTIN_NODE_STYLES.length,
    )
  })

  it('按 category 分栏，栏名是中文，栏序跟着预置库的次序', () => {
    const wrapper = mountPalette()
    const heads = wrapper.findAll('h3').map((head) => head.text())

    expect(heads).toEqual([
      '热源4',
      '容器2',
      '末端3',
      '换热1',
      '标注1',
      '电路符号8',
    ])
  })

  it('文档里同 id 的那份顶上去，名字用文档的，位置不动也不另起一栏', () => {
    const wrapper = mountPalette([OVERRIDE])

    expect(item(wrapper, OVERRIDE.id).text()).toContain('改过的余热')
    expect(wrapper.findAll('[data-test^="palette-item-"]')).toHaveLength(
      TWIN_2D_BUILTIN_NODE_STYLES.length,
    )
    expect(wrapper.findAll('h3')).toHaveLength(6)
  })

  it('自建的接在最后，自成一栏', () => {
    const wrapper = mountPalette([OWN])
    const heads = wrapper.findAll('h3').map((head) => head.text())

    expect(heads[heads.length - 1]).toBe('pump1')
    expect(item(wrapper, 'my-pump').text()).toContain('我的水泵')
  })

  it('自建与覆盖各有可辨的标记，预置库原样那些不标', () => {
    const wrapper = mountPalette([OWN, OVERRIDE])

    expect(item(wrapper, 'my-pump').text()).toContain('自建')
    expect(item(wrapper, OVERRIDE.id).text()).toContain('覆盖内置')
    expect(item(wrapper, 'circuit-resistor').text()).not.toContain('自建')
  })

  it('没起名的样式在卡片上退到 id，不至于只剩一张图', () => {
    const wrapper = mountPalette([{ ...OWN, name: '' }])

    expect(item(wrapper, 'my-pump').text()).toContain('my-pump')
    expect(item(wrapper, 'my-pump').attributes('title')).toContain('my-pump ·')
  })

  it('没有分类名的样式落到「未分类」', () => {
    const wrapper = mountPalette([{ ...OWN, category: '' }])
    const heads = wrapper.findAll('h3').map((head) => head.text())

    expect(heads[heads.length - 1]).toBe('未分类1')
  })
})

describe('缩略图是真画出来的', () => {
  it('每一项里都是这份样式画出来的节点，不是占位方块', () => {
    const wrapper = mountPalette()
    const box = item(wrapper, 'water-tank').get('.t2-node')

    expect(box.attributes('data-id')).toBe('water-tank')
    expect(box.element.children.length).toBeGreaterThan(0)
  })

  it('大样式按框等比缩小', () => {
    const wrapper = mountPalette()

    expect(zoomOf(wrapper, 'water-tank')).toBeCloseTo(46 / 140)
  })

  it('小到极点的符号最多放大两倍，不铺满整格', () => {
    const wrapper = mountPalette()

    expect(zoomOf(wrapper, 'circuit-junction')).toBe(2)
  })

  it('缩放盒量的是样式的缺省尺寸', () => {
    const wrapper = mountPalette()
    const style = item(wrapper, 'water-tank')
      .get('.t2p-fit')
      .attributes('style')

    expect(style).toContain('width: 196px')
    expect(style).toContain('height: 140px')
  })

  it('不挂 sprite 宿主——那是画布壳的活，两处都挂会让 symbol 在文档里重号', () => {
    const wrapper = mountPalette()

    expect(wrapper.find('.t2-sprite').exists()).toBe(false)
  })
})

describe('拖出去与点一下', () => {
  it('每一项都可拖，载荷是样式 id 且走自定义 MIME', () => {
    const wrapper = mountPalette()
    const target = item(wrapper, 'steam-source')
    const written: Record<string, string> = {}
    const transfer = {
      setData: (mime: string, value: string) => {
        written[mime] = value
      },
      effectAllowed: '',
    }
    const event = new Event('dragstart', { bubbles: true })
    Object.defineProperty(event, 'dataTransfer', { value: transfer })

    const element: Element = target.element

    expect(target.attributes('draggable')).toBe('true')
    element.dispatchEvent(event)

    expect(written[TWIN_2D_STYLE_DRAG_MIME]).toBe('steam-source')
    expect(transfer.effectAllowed).toBe('copy')
  })

  it('拿不到 dataTransfer 时安安静静地不做事', () => {
    const wrapper = mountPalette()
    const element: Element = item(wrapper, 'steam-source').element
    const event = new Event('dragstart', { bubbles: true })
    Object.defineProperty(event, 'dataTransfer', { value: null })

    expect(() => element.dispatchEvent(event)).not.toThrow()
  })

  it('点一下就是「在画布中央加一个」，抛的是样式 id', async () => {
    const wrapper = mountPalette()

    await item(wrapper, 'circuit-diode').trigger('click')

    expect(wrapper.emitted('add')).toEqual([['circuit-diode']])
  })
})

describe('搜索', () => {
  it('按名字过滤，其余整栏一起消失', async () => {
    const wrapper = mountPalette()

    await wrapper.get('input[data-test="palette-search"]').setValue('电阻')

    expect(wrapper.findAll('[data-test^="palette-item-"]')).toHaveLength(1)
    expect(item(wrapper, 'circuit-resistor').text()).toContain('电阻')
  })

  it('按 id 与分类名也搜得到', async () => {
    const wrapper = mountPalette()
    const search = wrapper.get('input[data-test="palette-search"]')

    await search.setValue('circuit-ground')
    expect(wrapper.findAll('[data-test^="palette-item-"]')).toHaveLength(1)

    await search.setValue('电路符号')
    expect(wrapper.findAll('[data-test^="palette-item-"]')).toHaveLength(8)
  })

  it('一个都没匹配上时出空态', async () => {
    const wrapper = mountPalette()

    await wrapper.get('input[data-test="palette-search"]').setValue('没有这种')

    expect(wrapper.find('[data-test="palette-empty"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-test^="palette-item-"]')).toHaveLength(0)
  })
})
