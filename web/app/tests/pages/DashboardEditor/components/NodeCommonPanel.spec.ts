/**
 * @fileoverview 契约：「通用配置」页管每个模块都有的那几样——名字、几何、层序、
 * 显隐、模块级卡片外观。
 * ⚠ 外观这一段的铁律是「未设置 = 删键」：清空最后一项要把整段 `__cardStyle` 删掉，
 * 留一只空袋在配置里，看上去像配过、导出的 JSON 也多一段永远读不出差别的噪声。
 */
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { ref, type Ref } from 'vue'

import { EDITOR_CANVAS_CARD_KEY } from '@/features/dashboard/editorContext'
import type { LayerPosition } from '@/features/dashboard/editorDoc'
import CardStyleFields from '@/components/chrome/CardStyleFields.vue'
import NodeCommonPanel from '@/pages/DashboardEditor/components/NodeCommonPanel.vue'

const MANIFEST: ModuleManifest = {
  type: 'demo',
  displayName: '演示',
  category: '演示',
  defaultSize: { width: 100, height: 100 },
  configSchema: [],
  bindings: [],
  component: () => Promise.resolve({ default: {} }),
}

function node(over: Partial<DashboardNodePayload> = {}): DashboardNodePayload {
  return {
    id: 'n1',
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: 'demo',
    x: 12,
    y: 34,
    w: 56,
    h: 78,
    zIndex: 0,
    isVisible: true,
    configJson: {},
    createdAt: '',
    updatedAt: '',
    bindings: [],
    ...over,
  }
}

function mountPanel(
  over: Partial<DashboardNodePayload> = {},
  manifest: ModuleManifest | undefined = MANIFEST,
  layer: LayerPosition | null = { index: 1, total: 3 },
  canvasCard?: Ref<unknown>,
) {
  return mount(NodeCommonPanel, {
    props: { node: node(over), manifest, layer },
    global:
      canvasCard === undefined
        ? {}
        : { provide: { [EDITOR_CANVAS_CARD_KEY as symbol]: canvasCard } },
  })
}

/** 从外观字段组那一侧推一袋新值上来，走组件的真实出口而不是敲控件。 */
async function pushChrome(
  wrapper: ReturnType<typeof mountPanel>,
  next: Record<string, unknown>,
): Promise<void> {
  const fields = wrapper.getComponent(CardStyleFields)
  fields.vm.$emit('update:modelValue', next)
  await wrapper.vm.$nextTick()
}

describe('几何与层序', () => {
  it('几何四项按节点当前坐标显示', () => {
    const numbers = mountPanel()
      .findAll('[data-test="geometry"] .dt-number__el')
      .map((input) => (input.element as HTMLInputElement).value)

    expect(numbers).toContain('12')
    expect(numbers).toContain('78')
  })

  it('改几何抛 geometry，且是连续输入', async () => {
    const wrapper = mountPanel()

    await wrapper
      .findAll('[data-test="geometry"] .dt-number__el')[0]
      ?.setValue('99')

    expect(wrapper.emitted('geometry')?.[0]).toEqual([
      { x: 99, y: 34, w: 56, h: 78 },
      true,
    ])
  })

  it('钉位节点只留高度可改', () => {
    const wrapper = mountPanel({}, { ...MANIFEST, region: 'header' })
    const disabled = wrapper
      .findAll('[data-test="geometry"] .dt-number__el')
      .map((input) => (input.element as HTMLInputElement).disabled)

    expect(disabled).toEqual([true, true, true, false])
  })

  it('层序五个键各抛各的档位', async () => {
    const wrapper = mountPanel()

    for (const kind of ['front', 'forward', 'backward', 'back', 'center']) {
      await wrapper.find(`[data-test="order-${kind}"]`).trigger('click')
    }

    expect(wrapper.emitted('order')).toEqual([
      ['front'],
      ['forward'],
      ['backward'],
      ['back'],
      ['center'],
    ])
  })

  it('标出这一层排第几，方便对着画布数', () => {
    expect(mountPanel().text()).toContain('第 2 / 3 层')
  })

  // center 是「视口滚动定位到节点」，不动几何——文案照着定位说，别再叫「居中」
  it('定位键的文案与无障碍名都说「定位」，档位键不变', () => {
    const button = mountPanel().get('[data-test="order-center"]')

    expect(button.text()).toBe('定位')
    expect(button.attributes('aria-label')).toBe('定位到此节点')
    expect(button.attributes('title')).toBe('定位到此节点')
  })

  it('已经在最上面时置顶与上移置灰，往下的两个照常', () => {
    const wrapper = mountPanel({}, MANIFEST, { index: 2, total: 3 })
    const isOff = (kind: string): boolean =>
      wrapper.find(`[data-test="order-${kind}"]`).attributes('disabled') !==
      undefined

    expect([isOff('front'), isOff('forward')]).toEqual([true, true])
    expect([isOff('back'), isOff('backward')]).toEqual([false, false])
  })

  it('已经在最下面时置底与下移置灰', () => {
    const wrapper = mountPanel({}, MANIFEST, { index: 0, total: 3 })
    const isOff = (kind: string): boolean =>
      wrapper.find(`[data-test="order-${kind}"]`).attributes('disabled') !==
      undefined

    expect([isOff('back'), isOff('backward')]).toEqual([true, true])
    expect([isOff('front'), isOff('forward')]).toEqual([false, false])
  })
})

describe('显隐与名字', () => {
  it('改显隐抛 visible', async () => {
    const wrapper = mountPanel()

    await wrapper.find('button[role="switch"]').trigger('click')

    expect(wrapper.emitted('visible')?.[0]).toEqual([false])
  })

  it('名字回填别名，没有别名时占位符是模块名', () => {
    const named = mountPanel({ configJson: { __label: '左上角标题' } })
    const bare = mountPanel()

    expect(named.get('input[data-test="node-name"]').attributes('value')).toBe(
      '左上角标题',
    )
    expect(
      bare.get('input[data-test="node-name"]').attributes('placeholder'),
    ).toBe('演示')
  })

  it('失焦提交名字', async () => {
    const wrapper = mountPanel()
    const input = wrapper.get('input[data-test="node-name"]')

    await input.setValue('新名字')
    await input.trigger('blur')

    expect(wrapper.emitted('rename')?.[0]).toEqual(['新名字'])
  })
})

describe('模块级卡片外观', () => {
  it('回填已存的模块级覆盖', () => {
    const wrapper = mountPanel({ configJson: { __cardStyle: { radius: 12 } } })
    const radius = wrapper
      .findAll('.dt-number__el')
      .find((input) => (input.element as HTMLInputElement).value === '12')

    expect(radius).toBeDefined()
  })

  it('改一项写进 __cardStyle 整袋', async () => {
    const wrapper = mountPanel()

    await pushChrome(wrapper, { radius: 8 })

    expect(wrapper.emitted('config')?.[0]).toEqual([
      ['__cardStyle'],
      { radius: 8 },
      false,
    ])
  })

  it('清空到一项不剩就把整段删掉，而不是留一只空袋', async () => {
    const wrapper = mountPanel({ configJson: { __cardStyle: { radius: 8 } } })

    await pushChrome(wrapper, { radius: '' })

    expect(wrapper.emitted('config')?.[0]).toEqual([
      ['__cardStyle'],
      undefined,
      false,
    ])
  })

  it('显式关掉的开关要留住——false 不是「没配」', async () => {
    const wrapper = mountPanel()

    await pushChrome(wrapper, { corners: false })

    expect(wrapper.emitted('config')?.[0]).toEqual([
      ['__cardStyle'],
      { corners: false },
      false,
    ])
  })

  it('清单显式关掉外观配置的模块不出这一段', () => {
    const wrapper = mountPanel({}, { ...MANIFEST, chromeConfigurable: false })

    expect(wrapper.text()).not.toContain('卡片外观')
  })

  // ⚠ 刻意的语义变化：袋子落库是自由 JSON，没登记进 CHROME_KEYS 的野键
  //   经面板任一次编辑写回后即被过滤，不再跟着这只袋子走
  it('存量袋子里的野键在任一次写回时被过滤掉', async () => {
    const wrapper = mountPanel({
      configJson: { __cardStyle: { radius: 8, hack: 'boom' } },
    })

    await pushChrome(wrapper, { radius: 8, hack: 'boom', titleGap: 4 })

    expect(wrapper.emitted('config')?.[0]).toEqual([
      ['__cardStyle'],
      { radius: 8, titleGap: 4 },
      false,
    ])
  })
})

describe('画布缺省与禁用联动', () => {
  it('画布缺省关了显示标题，模块级面板的标题条组即被禁用并说明', async () => {
    const canvasCard = ref<unknown>({ showTitle: false })
    const wrapper = mountPanel({}, MANIFEST, { index: 1, total: 3 }, canvasCard)

    const head = wrapper
      .findAll('.card-style__group')
      .find((button) => button.text().includes('标题条'))
    await head?.trigger('click')

    expect(wrapper.find('[data-test="card-group-off-title"]').text()).toContain(
      '显示标题',
    )
  })

  it('右栏改画布缺省时禁用态即时跟着变，不用重新选中', async () => {
    const canvasCard = ref<unknown>({ showTitle: false })
    const wrapper = mountPanel({}, MANIFEST, { index: 1, total: 3 }, canvasCard)
    const head = wrapper
      .findAll('.card-style__group')
      .find((button) => button.text().includes('标题条'))
    await head?.trigger('click')
    expect(wrapper.find('[data-test="card-group-off-title"]').exists()).toBe(
      true,
    )

    canvasCard.value = {}
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-test="card-group-off-title"]').exists()).toBe(
      false,
    )
  })

  it('模块级显式 showTitle=false 也能自己锁掉标题条组——两级合成后判定', async () => {
    const wrapper = mountPanel({
      configJson: { __cardStyle: { showTitle: false } },
    })
    const head = wrapper
      .findAll('.card-style__group')
      .find((button) => button.text().includes('标题条'))
    await head?.trigger('click')

    expect(wrapper.find('[data-test="card-group-off-title"]').exists()).toBe(
      true,
    )
  })
})
