/**
 * @fileoverview 契约：「专属配置」页完全由 `configSchema` 泛型渲染——面板里没有一行
 * 针对具体模块的表单代码，换一份清单就换一套表单，且缺省会铺进控件的当前值。
 * 几何 / 显隐 / 卡片外观归「通用配置」页，见 NodeCommonPanel.spec.ts。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import type {
  CardStyle,
  DashboardNodePayload,
  ModuleManifest,
  ModuleSubEditor,
} from '@dt/contracts'
import { __resetConfigControls } from '@dt/modules'

import { provideCardStyles } from '@/features/dashboard/cardStyleLibrary'
import { installConfigControls } from '@/features/dashboard/configControls'
import { EDITOR_SUB_EDITOR_KEY } from '@/features/dashboard/editorContext'
import PropertyPanel from '@/pages/DashboardEditor/components/PropertyPanel.vue'

const MANIFEST: ModuleManifest = {
  type: 'demo',
  displayName: '演示',
  category: '演示',
  defaultSize: { width: 100, height: 100 },
  configSchema: [
    {
      key: 'title',
      label: '标题',
      type: 'string',
      group: '标题',
      default: '缺省标题',
    },
    { key: 'showBar', label: '显示条', type: 'boolean', group: '标题' },
    {
      key: 'note',
      label: '备注',
      type: 'string',
      group: '标题',
      when: { key: 'showBar', in: [true] },
    },
    { key: 'accent', label: '强调色', type: 'color', group: '外观' },
  ],
  bindings: [],
  component: () => Promise.resolve({ default: {} }),
}

const NODE: DashboardNodePayload = {
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
}

beforeEach(() => {
  __resetConfigControls()
  installConfigControls()
})

describe('没有专属配置的模块', () => {
  it('给一句能看的空态，而不是一片空白', () => {
    const wrapper = mount(PropertyPanel, {
      props: { node: NODE, manifest: undefined },
    })

    expect(wrapper.text()).toContain('这个模块没有专属配置')
  })
})

describe('泛型渲染', () => {
  it('按清单声明摆出分段与字段标签', () => {
    const wrapper = mount(PropertyPanel, {
      props: { node: NODE, manifest: MANIFEST },
    })

    expect(wrapper.text()).toContain('标题')
    expect(wrapper.text()).toContain('外观')
    expect(wrapper.text()).toContain('强调色')
  })

  it('条件不满足的字段不出现，满足了才出现', () => {
    const off = mount(PropertyPanel, {
      props: { node: NODE, manifest: MANIFEST },
    })
    expect(off.text()).not.toContain('备注')

    const on = mount(PropertyPanel, {
      props: {
        node: { ...NODE, configJson: { showBar: true } },
        manifest: MANIFEST,
      },
    })
    expect(on.text()).toContain('备注')
  })

  it('清单缺省铺进控件的当前值', () => {
    const wrapper = mount(PropertyPanel, {
      props: { node: NODE, manifest: MANIFEST },
    })
    const input = wrapper.find('.dt-input__el')

    expect((input.element as HTMLInputElement).value).toBe('缺省标题')
  })

  it('清单声明了预设就摆出预设按钮，点一下整套抛上去', async () => {
    const preset = { id: 'p1', label: '极简', config: { title: 'x' } }
    const wrapper = mount(PropertyPanel, {
      props: {
        node: NODE,
        manifest: { ...MANIFEST, configPresets: [preset] },
      },
    })

    const pill = wrapper
      .findAll('button.dt-btn')
      .find((button) => button.text() === '极简')
    expect(pill).toBeDefined()
    await pill?.trigger('click')

    expect(wrapper.emitted('preset')?.[0]).toEqual([preset])
  })

  // 子集匹配：预设写过的键全部等于当前 resolved 值就点亮，多个同亮是正常的
  it('命中的预设走 DtButton 按压态（aria-pressed + soft），未命中的是 ghost', () => {
    const wrapper = mount(PropertyPanel, {
      props: {
        node: { ...NODE, configJson: { title: '缺省标题', showBar: true } },
        manifest: {
          ...MANIFEST,
          configPresets: [
            // 值恰等于清单缺省也算命中：resolved 铺过缺省后两者无从区分
            {
              id: 'hit-default',
              label: '默认标题',
              config: { title: '缺省标题' },
            },
            { id: 'hit-set', label: '开条', config: { showBar: true } },
            { id: 'miss', label: '别的', config: { title: '完全不同' } },
          ],
        },
      },
    })

    const stateOf = new Map(
      wrapper.findAll('button[aria-pressed]').map((button) => [
        button.text(),
        {
          pressed: button.attributes('aria-pressed'),
          active: button.classes('dt-btn--soft'),
        },
      ]),
    )

    expect(stateOf.get('默认标题')).toEqual({ pressed: 'true', active: true })
    expect(stateOf.get('开条')).toEqual({ pressed: 'true', active: true })
    expect(stateOf.get('别的')).toEqual({ pressed: 'false', active: false })
  })

  // ⚠ span 是清单里的声明字段：面板不消费它时 typecheck 与 lint 双双放行，
  //   声明 half 的字段只是静默占满整行。这条钉住「声明必须有消费方」
  it('span:half 的字段带半行占位类、其余整行，分组是两列栅格', () => {
    const wrapper = mount(PropertyPanel, {
      props: {
        node: NODE,
        manifest: {
          ...MANIFEST,
          configSchema: [
            { key: 'a', label: '甲', type: 'string', span: 'half' },
            { key: 'b', label: '乙', type: 'string', span: 'full' },
            { key: 'c', label: '丙', type: 'string' },
          ],
        },
      },
    })

    const grid = wrapper.find('.dt-prop__grid')
    expect(grid.exists()).toBe(true)
    expect(grid.findAll('.dt-prop__cell--half')).toHaveLength(1)
    expect(grid.find('.dt-prop__cell--half').text()).toContain('甲')
  })

  // 几何与显隐搬去「通用配置」页了，这里再出现就是两页各画一份
  it('不再画几何与显隐', () => {
    const wrapper = mount(PropertyPanel, {
      props: { node: NODE, manifest: MANIFEST },
    })

    expect(wrapper.text()).not.toContain('初始可见')
    expect(wrapper.findAll('.dt-number__el')).toHaveLength(0)
  })
})

describe('抛出的改动', () => {
  it('改配置抛 config，带路径与「是不是连续输入」', async () => {
    const wrapper = mount(PropertyPanel, {
      props: { node: NODE, manifest: MANIFEST },
    })

    await wrapper.find('.dt-input__el').setValue('新标题')

    expect(wrapper.emitted('config')?.[0]).toEqual([['title'], '新标题', true])
  })
})

// ⚠ 声明了子编辑器却仍画通用控件，用户就会在一个 JSON 框里改本该图形化配的东西，
//   而且改完与子编辑器互相覆盖——两处都不报错
describe('子编辑器入口', () => {
  const WITH_SUB: ModuleManifest = {
    ...MANIFEST,
    configSchema: [
      { key: 'title', label: '标题', type: 'string', group: '标题' },
      { key: 'scene', label: '场景', type: 'object', group: '场景' },
    ],
    subEditor: {
      configKey: 'scene',
      routeName: 'demo-editor',
      label: '打开场景编辑器',
      hint: '模型与锚点在那里配。',
    },
  }

  it('被接管的字段画成入口按钮，不再画通用控件', () => {
    const opened: ModuleSubEditor[] = []
    const wrapper = mount(PropertyPanel, {
      props: { node: NODE, manifest: WITH_SUB },
      global: {
        provide: {
          [EDITOR_SUB_EDITOR_KEY as symbol]: (sub: ModuleSubEditor) => {
            opened.push(sub)
          },
        },
      },
    })

    const button = wrapper
      .findAll('button')
      .find((item) => item.text() === '打开场景编辑器')
    expect(button).toBeDefined()
    expect(wrapper.text()).toContain('模型与锚点在那里配')
    expect(wrapper.text()).toContain('尚未配置')
  })

  // 不在编辑器里挂载（没人下发入口）时不该画一个点了没反应的按钮
  it('没人下发入口时不画按钮', () => {
    const wrapper = mount(PropertyPanel, {
      props: { node: NODE, manifest: WITH_SUB },
    })

    expect(
      wrapper
        .findAll('button')
        .some((item) => item.text() === '打开场景编辑器'),
    ).toBe(false)
  })

  it('点入口把这份声明原样交上去', async () => {
    const opened: ModuleSubEditor[] = []
    const wrapper = mount(PropertyPanel, {
      props: { node: NODE, manifest: WITH_SUB },
      global: {
        provide: {
          [EDITOR_SUB_EDITOR_KEY as symbol]: (sub: ModuleSubEditor) => {
            opened.push(sub)
          },
        },
      },
    })

    const button = wrapper
      .findAll('button')
      .find((item) => item.text() === '打开场景编辑器')
    await button?.trigger('click')

    expect(opened).toEqual([WITH_SUB.subEditor])
  })

  it('其余字段照旧走通用控件', () => {
    const wrapper = mount(PropertyPanel, {
      props: { node: NODE, manifest: WITH_SUB },
    })

    expect(wrapper.find('input').exists()).toBe(true)
  })

  it('配过之后入口上说得出来', () => {
    const wrapper = mount(PropertyPanel, {
      props: {
        node: { ...NODE, configJson: { scene: { anchors: [] } } },
        manifest: WITH_SUB,
      },
    })

    expect(wrapper.text()).toContain('已配置')
  })
})

/** 库里的一条样式。 */
function style(over: Partial<CardStyle> = {}): CardStyle {
  return {
    id: 's1',
    name: '蓝调科技卡',
    description: '呼吸描边',
    moduleType: 'demo',
    chrome: { radius: 4 },
    config: { accent: 'var(--accent-primary)' },
    thumbnail: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  }
}

/** 把面板挂在一个装了样式库的宿主里。 */
function mountWithLibrary(
  styles: readonly CardStyle[],
  onPreset: (preset: unknown) => void = () => {},
): ReturnType<typeof mount> {
  const host = defineComponent({
    setup() {
      provideCardStyles(() => styles)
      return () =>
        h(PropertyPanel, {
          node: NODE,
          manifest: MANIFEST,
          onPreset,
        })
    },
  })
  return mount(host)
}

describe('我存下来的样式', () => {
  it('绑了这个类型的摆成一排按钮', () => {
    const wrapper = mountWithLibrary([style()])

    expect(wrapper.text()).toContain('我的样式')
    expect(wrapper.text()).toContain('蓝调科技卡')
  })

  // ⚠ 通用外壳样式归「通用」页那个下拉：两处都列的话，同一条样式在右栏出现两次，
  //   而点哪一个结果还不一样
  it('通用外壳样式不列在这里', () => {
    const wrapper = mountWithLibrary([style({ moduleType: null })])

    expect(wrapper.text()).not.toContain('我的样式')
  })

  it('别的模块的样式也不列', () => {
    const wrapper = mountWithLibrary([style({ moduleType: '别的模块' })])

    expect(wrapper.text()).not.toContain('我的样式')
  })

  // ⚠ 外壳与内芯要一起落：只落内芯的话，用户看到「换了但边框没变」
  it('点下去上抛的预设里外壳与内芯都在', async () => {
    const seen: unknown[] = []
    const wrapper = mountWithLibrary([style()], (preset) => seen.push(preset))
    const button = wrapper
      .findAll('button')
      .find((one) => one.text() === '蓝调科技卡')
    await button?.trigger('click')

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      id: 'saved:s1',
      config: { accent: 'var(--accent-primary)', __cardStyle: { radius: 4 } },
    })
  })

  it('一条样式都没有时不摆那一段标题', () => {
    const wrapper = mountWithLibrary([])

    expect(wrapper.text()).not.toContain('我的样式')
  })
})
