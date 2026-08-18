/**
 * @fileoverview 守视口组件与场景内核之间的接线：props 的每一次变化都转下去、
 * 场景的每一路回调都转成 emit、状态决定覆盖层画什么、卸载时场景被释放。
 * ⚠ 场景内核在这里换成替身：happy-dom 没有 WebGL，真内核在这一层只能走降级分支，
 * 而降级分支盖不住「配置换了转没转下去」这类接线缺陷。
 */
import type * as ThreeCore from '@dt/three-core'
import type {
  EditorSceneOptions,
  TwinCameraPose,
  TwinSceneSelection,
} from '@dt/three-core'
import { normalizeTwinConfig, type TwinConfig } from '@dt/twin-config'
import { mount } from '@vue/test-utils'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest'

import TwinViewport from '@/pages/TwinEditor/components/TwinViewport.vue'
import type { TwinSelection } from '@/pages/TwinEditor/scripts/types'

interface SceneStub {
  options: EditorSceneOptions
  setConfig: Mock
  setSelection: Mock
  setPickMode: Mock
  focus: Mock
  snapshot: Mock
  dispose: Mock
}

const seam = vi.hoisted<{ instances: SceneStub[]; pose: TwinCameraPose }>(
  () => ({
    instances: [],
    pose: { position: [1, 2, 3], target: [0, 0, 0], fov: 50 },
  }),
)

// ⚠ 只换掉桶文件里的 `EditorScene` 一项：组件还从同一个包里拿类型与常量，
// 整包替身会把它们一起挖空
vi.mock('@dt/three-core', async (importOriginal) => {
  const actual = await importOriginal<typeof ThreeCore>()

  class FakeEditorScene {
    readonly options: EditorSceneOptions
    readonly setConfig = vi.fn()
    readonly setSelection = vi.fn()
    readonly setPickMode = vi.fn()
    readonly focus = vi.fn()
    readonly snapshot = vi.fn(() => seam.pose)
    readonly dispose = vi.fn()

    constructor(options: EditorSceneOptions) {
      this.options = options
      seam.instances.push(this)
    }
  }
  return { ...actual, EditorScene: FakeEditorScene }
})

function twinConfig(overrides: Record<string, unknown> = {}): TwinConfig {
  return normalizeTwinConfig({ model: { asset: '' }, ...overrides })
}

function mountViewport(props: Record<string, unknown> = {}) {
  return mount(TwinViewport, {
    props: { config: twinConfig(), selection: null, pickMode: null, ...props },
    attachTo: document.body,
  })
}

function scene(): SceneStub {
  const instance = seam.instances.at(-1)
  if (instance === undefined) throw new Error('视口没有建起场景')
  return instance
}

beforeEach(() => {
  seam.instances.length = 0
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('接线', () => {
  it('挂载时把宿主与配置交给场景，并同步初始选中与拾取模式', () => {
    const config = twinConfig()
    const wrapper = mountViewport({
      config,
      selection: { kind: 'anchors', id: 'a1' },
      pickMode: 'node',
    })

    // ⚠ 只能比结构：测试工具把 props 深响应式包了一层，进到场景里的是它的代理
    expect(scene().options.config).toStrictEqual(config)
    // ⚠ 场景挂的是内层视口不是外层舞台：舞台只负责按目标格子的宽高比居中留边
    expect(scene().options.container).toBe(
      wrapper.find('.twin-viewport').element,
    )
    expect(scene().setSelection).toHaveBeenCalledWith({
      kind: 'anchors',
      id: 'a1',
    })
    expect(scene().setPickMode).toHaveBeenCalledWith('node')
    wrapper.unmount()
  })

  it('配置换引用时转给场景', async () => {
    const wrapper = mountViewport()
    const next = twinConfig({ anchors: [{ id: 'a1' }] })

    await wrapper.setProps({ config: next })

    expect(scene().setConfig).toHaveBeenCalledWith(next)
    wrapper.unmount()
  })

  it('选中与拾取模式变化时都转给场景', async () => {
    const wrapper = mountViewport()

    await wrapper.setProps({
      selection: { kind: 'model' },
      pickMode: 'position',
    })

    expect(scene().setSelection).toHaveBeenLastCalledWith({ kind: 'model' })
    expect(scene().setPickMode).toHaveBeenLastCalledWith('position')
    wrapper.unmount()
  })

  it('卸载时释放场景', () => {
    const wrapper = mountViewport()
    const stub = scene()

    wrapper.unmount()

    expect(stub.dispose).toHaveBeenCalledTimes(1)
  })
})

describe('回调转成事件', () => {
  it('视口点选转成 select，点空白转成 select null', () => {
    const wrapper = mountViewport()

    scene().options.on.select({ kind: 'anchors', id: 'a1' })
    scene().options.on.select(null)

    expect(wrapper.emitted('select')).toEqual([
      [{ kind: 'anchors', id: 'a1' }],
      [null],
    ])
    wrapper.unmount()
  })

  it('节点、坐标、节点清单与机位各自转成对应的事件', () => {
    const wrapper = mountViewport()

    scene().options.on.pickNode('pump')
    scene().options.on.pickPosition([1, 2, 3])
    scene().options.on.modelNodes(['pump', 'valve'])
    scene().options.on.cameraChange(seam.pose)

    expect(wrapper.emitted('pickNode')).toEqual([['pump']])
    expect(wrapper.emitted('pickPosition')).toEqual([[[1, 2, 3]]])
    expect(wrapper.emitted('modelNodes')).toEqual([[['pump', 'valve']]])
    expect(wrapper.emitted('cameraChange')).toEqual([[seam.pose]])
    wrapper.unmount()
  })

  it('状态变化转成 status 事件', () => {
    const wrapper = mountViewport()

    scene().options.on.status('loading', '')
    scene().options.on.status('ready', '')

    expect(wrapper.emitted('status')).toEqual([['loading'], ['ready']])
    wrapper.unmount()
  })
})

describe('覆盖层', () => {
  it('还没挑模型时说未选择模型', () => {
    const wrapper = mountViewport()

    expect(wrapper.text()).toContain('未选择模型')
    wrapper.unmount()
  })

  it('出错时把原因原样显示出来', async () => {
    const wrapper = mountViewport()

    scene().options.on.status('error', '模型地址解析失败')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('模型地址解析失败')
    wrapper.unmount()
  })

  it('装载中显示加载提示', async () => {
    const wrapper = mountViewport()

    scene().options.on.status('loading', '')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('模型加载中')
    wrapper.unmount()
  })

  it('就绪后覆盖层让位给画面', async () => {
    const wrapper = mountViewport()

    scene().options.on.status('ready', '')
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).not.toContain('未选择模型')
    expect(wrapper.text()).not.toContain('模型加载中')
    wrapper.unmount()
  })

  it('拾取模式下给出提示条，回到浏览态就收起', async () => {
    const wrapper = mountViewport({ pickMode: 'position' })

    expect(wrapper.text()).toContain('世界坐标')

    await wrapper.setProps({ pickMode: null })
    expect(wrapper.text()).not.toContain('世界坐标')
    wrapper.unmount()
  })

  it('背景配的是 token 时套上 var()', () => {
    const wrapper = mountViewport({
      config: twinConfig({
        model: { asset: '', background: '--surface-base' },
      }),
    })

    expect(wrapper.find('.twin-viewport').attributes('style')).toContain(
      'var(--surface-base)',
    )
    wrapper.unmount()
  })
})

describe('选中形状的两份声明', () => {
  it('页面侧与视口侧的选中可以互相赋值', () => {
    const fromPage: TwinSelection = { kind: 'anchors', id: 'a1' }
    const toScene: TwinSceneSelection = fromPage
    const back: TwinSelection = toScene

    expect(back).toBe(fromPage)
  })
})

describe('暴露给页面的两个方法', () => {
  it('对焦请求转给场景', () => {
    const wrapper = mountViewport()

    wrapper.vm.focus({ kind: 'parts', id: 'part-pump' })

    expect(scene().focus).toHaveBeenCalledWith({
      kind: 'parts',
      id: 'part-pump',
    })
    wrapper.unmount()
  })

  it('取当前机位给出场景的快照', () => {
    const wrapper = mountViewport()

    expect(wrapper.vm.snapshot()).toEqual(seam.pose)
    wrapper.unmount()
  })
})

describe('按大屏格子留边', () => {
  // ⚠ 不留边的话编辑区与大屏格子的宽高比不同，相机 aspect 跟着不同，
  // 同一份配置在两边取景不一样——看起来就是「牌与模型的大小对不上」
  it('给了目标尺寸就按它的宽高比锁住视口', () => {
    const wrapper = mountViewport({
      targetSize: { width: 1280, height: 720 },
    })

    const style = wrapper.find('.twin-viewport').attributes('style') ?? ''
    expect(style).toContain('aspect-ratio: 1280 / 720')
    wrapper.unmount()
  })

  // ⚠ 这条守的是一次真实的回归：宽高都写 auto 时，视口里只有绝对定位的
  // canvas、没有流内容，两个方向双双塌成 0——模型整个不显示且不报任何错
  it('高度撑满而不是 auto，宽度才有的推', () => {
    const wrapper = mountViewport({
      targetSize: { width: 1280, height: 720 },
    })

    const style = wrapper.find('.twin-viewport').attributes('style') ?? ''
    expect(style).toContain('height: 100%')
    expect(style).not.toContain('height: auto')
    wrapper.unmount()
  })

  it('没给尺寸时铺满，不凭空锁一个比例', () => {
    const wrapper = mountViewport()

    const style = wrapper.find('.twin-viewport').attributes('style') ?? ''
    expect(style).not.toContain('aspect-ratio')
    wrapper.unmount()
  })

  it('尺寸不合法时当没给', () => {
    const wrapper = mountViewport({ targetSize: { width: 0, height: 720 } })

    const style = wrapper.find('.twin-viewport').attributes('style') ?? ''
    expect(style).not.toContain('aspect-ratio')
    wrapper.unmount()
  })
})
