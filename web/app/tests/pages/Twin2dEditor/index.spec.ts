/**
 * @fileoverview 契约：页面骨架的接线。三栏与顶栏各就各位、取数三态挡在前面、
 * 顶栏五个动作各自落到文档态或页面状态上，以及两道未保存守卫。
 *
 * ⚠ 两道守卫缺一不可：站内跳转拦在 `onBeforeRouteLeave`，关标签页 / 刷新拦在
 * `useUnsavedGuard`。这一页的改动只在内存里，漏一道就是「改了半天，一走全没」。
 * ⚠ 取数与落库的行为归 `useTwin2dEditorPage.test.ts`；这里换成一份手搓的页面状态，
 * 为的是把「脏着」「冲突」「出错」这几种界面分支逐个摆出来。
 * ⚠ 画布层自己那些行为归 `EditorStage.test.ts`；这里只看两处接线：改动落不落进撤销栈、
 * 实体没了之后选中里还留不留着它。
 * ⚠ 键盘手势必须**让位表单**，判据是最近可交互祖先（含 `role=combobox` 这类）：只看
 * `tagName` 的话，用户用键盘翻下拉时画布上选中的节点会同时被 nudge 一格并压进撤销栈
 * ——不报错，只是图悄悄动了。下面「翻下拉时节点不动」那一条正是钉这件事的。
 */
import type { DashboardNodePayload, DashboardPayload } from '@dt/contracts'
import { normalizeTwin2dConfig } from '@dt/twin2d'
import type { Twin2dConfig } from '@dt/twin2d'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, ref, shallowRef } from 'vue'
import type { Ref } from 'vue'

const guard = vi.hoisted(() => ({
  leave: null as (() => Promise<boolean>) | null,
}))
const stub = vi.hoisted(() => ({ page: {} }))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({
    path: '/dashboards/d1/edit/twin-2d/n1',
    params: { dashboardId: 'd1', nodeId: 'n1' },
    query: {},
  }),
  onBeforeRouteLeave: (fn: () => Promise<boolean>) => {
    guard.leave = fn
  },
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}))

const toastSuccess = vi.fn()
const toastError = vi.fn()
const confirmAsk = vi.fn<() => Promise<boolean>>()
vi.mock('@dt/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dt/ui')
  return {
    ...actual,
    useToast: () => ({
      success: toastSuccess,
      error: toastError,
      info: vi.fn(),
    }),
    useConfirm: () => ({ ask: confirmAsk }),
  }
})

vi.mock('@/pages/Twin2dEditor/scripts/useTwin2dEditorPage', () => ({
  useTwin2dEditorPage: () => stub.page,
}))

import EditorStage from '@/pages/Twin2dEditor/components/EditorStage.vue'
import Twin2dInspector from '@/pages/Twin2dEditor/components/Twin2dInspector.vue'
import Twin2dEditor from '@/pages/Twin2dEditor/index.vue'
import type { Twin2dEditorSelection } from '@/pages/Twin2dEditor/scripts/editorSelection'
import { createTwin2dDoc } from '@/pages/Twin2dEditor/scripts/twin2dDoc'
import type { Twin2dDoc } from '@/pages/Twin2dEditor/scripts/twin2dDoc'
import type { Twin2dEditorPage } from '@/pages/Twin2dEditor/scripts/useTwin2dEditorPage'

/** 一个节点引着不存在的样式，于是诊断里稳定地有一条。 */
const CONFIG: Twin2dConfig = normalizeTwin2dConfig({
  canvas: { width: 800, height: 600, grid: 20 },
  nodes: [{ id: 'a', styleId: 'nope' }],
})

function node(): DashboardNodePayload {
  return {
    id: 'n1',
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: 'twin-2d-view',
    x: 0,
    y: 0,
    w: 640,
    h: 360,
    zIndex: 0,
    isVisible: true,
    configJson: {},
    createdAt: '',
    updatedAt: '',
    bindings: [],
  }
}

function dashboard(): DashboardPayload {
  return {
    id: 'd1',
    projectId: 'p1',
    name: '一号屏',
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    rowVersion: 7,
    schemaVersion: 1,
    isPublic: false,
    chromeJson: {},
    themeJson: {},
    createdAt: '',
    updatedAt: '',
    nodes: [node()],
  }
}

interface Controls {
  doc: Ref<Twin2dDoc | null>
  loading: Ref<boolean>
  error: Ref<string | null>
  conflict: Ref<string | null>
  save: ReturnType<typeof vi.fn<() => Promise<boolean>>>
  reload: ReturnType<typeof vi.fn<() => Promise<void>>>
  dispose: ReturnType<typeof vi.fn<() => void>>
  page: Twin2dEditorPage
}

function makeControls(): Controls {
  const doc = shallowRef<Twin2dDoc | null>(
    createTwin2dDoc({ config: CONFIG, bindings: [] }),
  )
  const loading = ref(false)
  const error = ref<string | null>(null)
  const conflict = ref<string | null>(null)
  const save = vi.fn<() => Promise<boolean>>(() => Promise.resolve(true))
  const reload = vi.fn<() => Promise<void>>(() => Promise.resolve())
  const dispose = vi.fn<() => void>()
  const page: Twin2dEditorPage = {
    doc: computed(() => doc.value),
    dashboard: ref<DashboardPayload | null>(dashboard()),
    node: computed(() => node()),
    targetSize: computed(() => ({ width: 640, height: 360 })),
    loading,
    saving: ref(false),
    error: computed(() => error.value),
    conflict,
    save,
    reload,
    dispose,
  }
  return { doc, loading, error, conflict, save, reload, dispose, page }
}

let controls = makeControls()

// ⚠ `useUnsavedGuard` 把监听挂在全局 window 上，用例之间会互相串门：留一个脏着的
// 页面没拆，后面每一条「干净时不拦关页」都会被它拦下
const mounted: ReturnType<typeof mount>[] = []

function mountPage() {
  const wrapper = mount(Twin2dEditor, {
    global: { stubs: { Teleport: true } },
  })
  mounted.push(wrapper)
  return wrapper
}

/**
 * 取画布层拿到的那一份选中态。
 * ⚠ 过一手 `unknown` 再收：typescript-eslint 解析不出 `.vue` 的模块，props 在它眼里
 * 是「解析不出的类型」，真正的类型检查由 `vue-tsc` 做（同 EditorCanvas.test.ts 那条）。
 * @param wrapper 挂好的这一页
 */
function selectionOf(
  wrapper: ReturnType<typeof mountPage>,
): Twin2dEditorSelection {
  const given: unknown = wrapper.findComponent(EditorStage).props('selection')
  if (given === null || typeof given !== 'object') {
    throw new Error('画布层没拿到选中态')
  }
  return given as Twin2dEditorSelection
}

/** 改一笔配置，让文档脏起来。 */
async function dirty(wrapper: ReturnType<typeof mountPage>): Promise<void> {
  const doc = controls.doc.value
  doc?.commit(normalizeTwin2dConfig({ canvas: { width: 900 } }))
  await nextTick()
  await wrapper.vm.$nextTick()
}

/** 真发一次关页事件，回答「浏览器这次会不会问」。 */
function isBlocked(): boolean {
  const event = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(event)
  return event.defaultPrevented
}

beforeEach(() => {
  setActivePinia(createPinia())
  guard.leave = null
  controls = makeControls()
  stub.page = controls.page
  toastSuccess.mockReset()
  toastError.mockReset()
  confirmAsk.mockReset()
  confirmAsk.mockResolvedValue(false)
})

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
  vi.restoreAllMocks()
})

describe('三栏骨架', () => {
  it('大纲、画布、检查器三栏都在', () => {
    const wrapper = mountPage()

    expect(wrapper.find('[data-test="outline"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="canvas"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="inspector"]').exists()).toBe(true)
  })

  it('大纲上写着四类实体各有几条', () => {
    const wrapper = mountPage()

    expect(wrapper.find('[data-test="outline"]').text()).toContain('节点 1')
  })

  it('画布区写着这张图自己的坐标系', () => {
    const wrapper = mountPage()

    const text = wrapper.find('[data-test="canvas"]').text()
    expect(text).toContain('800 × 600')
    expect(text).toContain('栅格 20')
  })

  // ⚠ 编辑区与大屏格子的宽高比不同的话，同一份配置两边取景不一样
  it('检查器写着这块图在大屏上的占位', () => {
    const wrapper = mountPage()

    expect(wrapper.find('[data-test="inspector"]').text()).toContain(
      '640 × 360',
    )
  })
})

describe('取数三态', () => {
  it('取数中先不画三栏', () => {
    controls.loading.value = true

    const wrapper = mountPage()

    expect(wrapper.find('[data-test="canvas"]').exists()).toBe(false)
  })

  it('出错时把话摆出来', () => {
    controls.error.value = '这张大屏上没有这个节点，可能已被删除。'

    const wrapper = mountPage()

    expect(wrapper.text()).toContain('没有这个节点')
    expect(wrapper.find('[data-test="canvas"]').exists()).toBe(false)
  })

  it('出错时点重试重新取一次', async () => {
    controls.error.value = '加载失败'
    const wrapper = mountPage()

    const retry = wrapper
      .findAll('button')
      .find((item) => item.text().includes('重试'))
    await retry?.trigger('click')

    expect(controls.reload).toHaveBeenCalledTimes(1)
  })

  it('文档还没读出来时也不画三栏', () => {
    controls.doc.value = null

    const wrapper = mountPage()

    expect(wrapper.find('[data-test="outline"]').exists()).toBe(false)
  })
})

describe('顶栏动作', () => {
  it('保存成功弹一句成功', async () => {
    const wrapper = mountPage()
    await dirty(wrapper)

    await wrapper.find('[data-test="save"]').trigger('click')
    await flushPromises()

    expect(controls.save).toHaveBeenCalledTimes(1)
    expect(toastSuccess).toHaveBeenCalledWith('2D 孪生已保存')
  })

  it('保存失败弹一句可以照做的话', async () => {
    controls.save.mockResolvedValue(false)
    const wrapper = mountPage()
    await dirty(wrapper)

    await wrapper.find('[data-test="save"]').trigger('click')
    await flushPromises()

    expect(toastError).toHaveBeenCalledWith('保存失败，请重试')
  })

  it('版本撞了就把冲突那句话原样弹出来', async () => {
    controls.save.mockImplementation(() => {
      controls.conflict.value = '这张大屏在别处被改过'
      return Promise.resolve(false)
    })
    const wrapper = mountPage()
    await dirty(wrapper)

    await wrapper.find('[data-test="save"]').trigger('click')
    await flushPromises()

    expect(toastError).toHaveBeenCalledWith('这张大屏在别处被改过')
  })

  it('撤销把配置退回上一帧', async () => {
    const wrapper = mountPage()
    await dirty(wrapper)

    await wrapper.find('[data-test="undo"]').trigger('click')

    expect(controls.doc.value?.config.value.canvas.width).toBe(800)
  })

  it('重做再把它推回去', async () => {
    const wrapper = mountPage()
    await dirty(wrapper)
    await wrapper.find('[data-test="undo"]').trigger('click')

    await wrapper.find('[data-test="redo"]').trigger('click')

    expect(controls.doc.value?.config.value.canvas.width).toBe(900)
  })

  // 画布层订阅这个信号取一次景；骨架期它落在容器属性上
  it('点适应把取景信号加一', async () => {
    const wrapper = mountPage()
    const before = wrapper.find('[data-test="canvas"]').attributes()

    await wrapper.find('[data-test="fit"]').trigger('click')

    expect(before['data-fit-request']).toBe('0')
    expect(
      wrapper.find('[data-test="canvas"]').attributes('data-fit-request'),
    ).toBe('1')
  })
})

describe('画布装配', () => {
  it('画布那一栏里装着画布层', () => {
    const wrapper = mountPage()

    expect(
      wrapper.find('[data-test="canvas"] [data-test="canvas-host"]').exists(),
    ).toBe(true)
  })

  it('画布上抛的整份配置落一步撤销', async () => {
    const wrapper = mountPage()

    wrapper
      .findComponent(EditorStage)
      .vm.$emit('change', normalizeTwin2dConfig({ canvas: { width: 640 } }))
    await nextTick()

    expect(controls.doc.value?.config.value.canvas.width).toBe(640)
    expect(controls.doc.value?.canUndo.value).toBe(true)
  })

  // ⚠ 不摘的表现是右栏画着一个已经不存在的东西，改哪一项都写不回去且不报错
  it('实体没了之后选中里不再留着它', async () => {
    const wrapper = mountPage()
    const selection = selectionOf(wrapper)
    selection.select('nodes', 'a')

    wrapper
      .findComponent(EditorStage)
      .vm.$emit('change', normalizeTwin2dConfig({ canvas: { width: 640 } }))
    await nextTick()

    expect(selection.pick.value).toBeNull()
  })
})

/** 右栏当前画的是哪一段。 */
function inspectorKind(wrapper: ReturnType<typeof mountPage>): string {
  const host = wrapper.find(
    '[data-test="inspector"] [data-test="twin2d-inspector"]',
  )
  return host.attributes('data-kind') ?? ''
}

/**
 * 选中那个节点，等右栏换过去。
 * @param wrapper 挂好的这一页
 */
async function pickTheNode(
  wrapper: ReturnType<typeof mountPage>,
): Promise<void> {
  selectionOf(wrapper).select('nodes', 'a')
  await nextTick()
  await wrapper.vm.$nextTick()
}

/** 文档里那个节点当前的显示名。 */
function labelNow(): string {
  return controls.doc.value?.config.value.nodes[0]?.label ?? ''
}

describe('检查器装配', () => {
  it('没选中时右栏是画布检查器', () => {
    const wrapper = mountPage()

    expect(inspectorKind(wrapper)).toBe('canvas')
  })

  it('选中一个节点，右栏换成节点检查器', async () => {
    const wrapper = mountPage()

    await pickTheNode(wrapper)

    expect(inspectorKind(wrapper)).toBe('node')
    expect(wrapper.find('input[data-test="node-label"]').exists()).toBe(true)
  })

  it('检查器上抛的一次性改动落一步撤销', async () => {
    const wrapper = mountPage()

    await wrapper.find('[data-test="canvas-show-grid"]').trigger('click')

    expect(controls.doc.value?.config.value.canvas.showGrid).toBe(true)
    expect(controls.doc.value?.canUndo.value).toBe(true)
  })

  // ⚠ 每敲一个字母塞一帧进撤销栈，撤销键就等于废了：按二十下才退得回一个词
  it('显示名连敲五个字母，撤销栈只多一格', async () => {
    const wrapper = mountPage()
    await pickTheNode(wrapper)
    const box = wrapper.find('input[data-test="node-label"]')

    for (const text of ['电', '电阻', '电阻 ', '电阻 R', '电阻 R1']) {
      await box.setValue(text)
    }

    expect(labelNow()).toBe('电阻 R1')
    controls.doc.value?.undo()
    expect(labelNow()).toBe('')
    expect(controls.doc.value?.canUndo.value).toBe(false)
  })

  it('焦点离开输入框就断段，再敲另起一帧', async () => {
    const wrapper = mountPage()
    await pickTheNode(wrapper)
    const box = wrapper.find('input[data-test="node-label"]')

    await box.setValue('电')
    await box.trigger('focusout')
    await box.setValue('电阻')

    controls.doc.value?.undo()
    expect(labelNow()).toBe('电')
  })
})

describe('诊断', () => {
  it('顶栏上写着问题条数', () => {
    const wrapper = mountPage()

    expect(wrapper.find('[data-test="issues"]').text()).toContain('1')
  })

  it('默认收着，点一下才展开', async () => {
    const wrapper = mountPage()
    expect(wrapper.find('[data-test="diagnostics"]').exists()).toBe(false)

    await wrapper.find('[data-test="issues"]').trigger('click')

    expect(wrapper.find('[data-test="diagnostics"]').text()).toContain('nope')
  })

  it('再点一下收回去', async () => {
    const wrapper = mountPage()
    await wrapper.find('[data-test="issues"]').trigger('click')

    await wrapper.find('[data-test="issues"]').trigger('click')

    expect(wrapper.find('[data-test="diagnostics"]').exists()).toBe(false)
  })

  it('清单条数与顶栏计数一致', async () => {
    const wrapper = mountPage()

    await wrapper.find('[data-test="issues"]').trigger('click')

    expect(wrapper.findAll('[data-test="diagnostics"] li')).toHaveLength(1)
  })
})

describe('版本冲突出口', () => {
  it('冲突时摆出重新加载入口', async () => {
    const wrapper = mountPage()
    expect(wrapper.find('[data-test="conflict"]').exists()).toBe(false)

    controls.conflict.value = '这张大屏在别处被改过'
    await nextTick()

    expect(wrapper.find('[data-test="conflict"]').text()).toContain(
      '别处被改过',
    )
  })

  it('点重新加载就整份重取', async () => {
    const wrapper = mountPage()
    controls.conflict.value = '这张大屏在别处被改过'
    await nextTick()

    await wrapper.find('[data-test="conflict-reload"]').trigger('click')

    expect(controls.reload).toHaveBeenCalledTimes(1)
  })
})

describe('未保存守卫', () => {
  it('干净时站内跳转直接放行', async () => {
    mountPage()

    expect(await guard.leave?.()).toBe(true)
    expect(confirmAsk).not.toHaveBeenCalled()
  })

  it('脏着时站内跳转先问一句，用户点取消就留在这一页', async () => {
    const wrapper = mountPage()
    await dirty(wrapper)

    const allowed = await guard.leave?.()

    expect(confirmAsk).toHaveBeenCalledTimes(1)
    expect(allowed).toBe(false)
  })

  // ⚠ 站内那道拦不住关标签页 / 刷新，这一页没有本地草稿可恢复
  it('脏着时关标签页也被拦下', async () => {
    const wrapper = mountPage()

    await dirty(wrapper)

    expect(isBlocked()).toBe(true)
  })

  it('干净时不拦关页，页面才进得了 bfcache', () => {
    mountPage()

    expect(isBlocked()).toBe(false)
  })
})

/**
 * 造一个真的可交互祖先并把焦点放上去。
 * ⚠ 用真节点而不是桩：判据是 `activeElement.closest(...)`，桩掉它等于把这条契约
 * 换成「我以为它是怎么判的」。
 * @param attrs 这个元素上的属性
 */
function focusOn(attrs: Readonly<Record<string, string>>): HTMLElement {
  const host = document.createElement('button')
  for (const [key, value] of Object.entries(attrs))
    host.setAttribute(key, value)
  document.body.appendChild(host)
  host.focus()
  return host
}

/** 真发一次方向键。 */
function pressArrow(): void {
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    }),
  )
}

/** 文档里那个节点当前的横坐标。 */
function xNow(): number {
  return controls.doc.value?.config.value.nodes[0]?.x ?? -1
}

/**
 * 选中那个节点，等选中态生效。
 * @param wrapper 挂好的这一页
 */
async function pickNodeA(wrapper: ReturnType<typeof mountPage>): Promise<void> {
  selectionOf(wrapper).select('nodes', 'a')
  await nextTick()
}

describe('键盘手势让位表单', () => {
  it('焦点在下拉触发器上按方向键，节点一步不动', async () => {
    const wrapper = mountPage()
    await pickNodeA(wrapper)
    const before = xNow()
    const box = focusOn({ role: 'combobox' })

    pressArrow()
    await nextTick()

    expect(xNow()).toBe(before)
    expect(controls.doc.value?.canUndo.value).toBe(false)
    box.remove()
  })

  it('焦点在输入框里按方向键也一步不动', async () => {
    const wrapper = mountPage()
    await pickNodeA(wrapper)
    const before = xNow()
    const field = document.createElement('input')
    document.body.appendChild(field)
    field.focus()

    pressArrow()
    await nextTick()

    expect(xNow()).toBe(before)
    field.remove()
  })

  it('焦点在弹窗里的普通按钮上也让位', async () => {
    const wrapper = mountPage()
    await pickNodeA(wrapper)
    const before = xNow()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    const inside = document.createElement('button')
    dialog.appendChild(inside)
    document.body.appendChild(dialog)
    inside.focus()

    pressArrow()
    await nextTick()

    expect(xNow()).toBe(before)
    dialog.remove()
  })

  it('焦点在画布上按方向键，节点真的动了', async () => {
    const wrapper = mountPage()
    await pickNodeA(wrapper)
    const before = xNow()
    const stage = focusOn({ 'data-test': 'plain-canvas-host' })

    pressArrow()
    await nextTick()

    expect(xNow()).toBe(before + CONFIG.canvas.grid)
    expect(controls.doc.value?.canUndo.value).toBe(true)
    stage.remove()
  })

  it('走的时候把 window 上那道监听摘干净', async () => {
    const wrapper = mountPage()
    await pickNodeA(wrapper)
    const before = xNow()

    wrapper.unmount()
    pressArrow()

    expect(xNow()).toBe(before)
  })
})

describe('左栏装配', () => {
  it('大纲与调色板都在左栏里', () => {
    const wrapper = mountPage()

    const left = wrapper.find('[data-test="outline"]')
    expect(left.find('[data-test="twin2d-outline"]').exists()).toBe(true)
    expect(left.find('[data-test="node-palette"]').exists()).toBe(true)
  })

  it('点调色板上的一项就往画布中央加一个节点', async () => {
    const wrapper = mountPage()
    const item = wrapper.findAll('[data-test^="palette-item-"]')[0]

    await item?.trigger('click')

    const nodes = controls.doc.value?.config.value.nodes ?? []
    expect(nodes).toHaveLength(2)
    expect(nodes[1]?.x).toBe(CONFIG.canvas.width / 2)
  })

  it('大纲改出来的整份配置落一步撤销', async () => {
    const wrapper = mountPage()
    await pickNodeA(wrapper)

    await wrapper.find('[data-test="outline-remove-nodes"]').trigger('click')

    expect(controls.doc.value?.config.value.nodes).toHaveLength(0)
    expect(controls.doc.value?.canUndo.value).toBe(true)
  })
})

describe('样式库抽屉', () => {
  it('默认收着，点一下才开', async () => {
    const wrapper = mountPage()
    expect(wrapper.find('[data-test="style-lib-rows"]').exists()).toBe(false)

    await wrapper.find('[data-test="open-style-library"]').trigger('click')

    expect(wrapper.find('[data-test="style-lib-rows"]').exists()).toBe(true)
  })

  it('在库里点一份样式，右栏换成样式面、抽屉让开', async () => {
    const wrapper = mountPage()
    await wrapper.find('[data-test="open-style-library"]').trigger('click')

    const row = wrapper.findAll('[data-test^="style-lib-open-styles:"]')[0]
    await row?.trigger('click')

    expect(inspectorKind(wrapper)).toBe('style')
    expect(wrapper.find('[data-test="style-lib-rows"]').exists()).toBe(false)
  })

  it('退出样式编辑之后右栏回到画布那一段', async () => {
    const wrapper = mountPage()
    selectionOf(wrapper).focusStyle('styles', 'nope')
    await nextTick()

    await wrapper.find('[data-test="close-style-focus"]').trigger('click')

    expect(inspectorKind(wrapper)).toBe('canvas')
  })

  // ⚠ 图元 id 只在它自己那份样式里唯一：留着上一份的 id 会让右栏画出另一份样式里
  // 同名的那一枚，而改哪一项都落在别人身上
  it('换一份样式就把图元选中清掉', async () => {
    const wrapper = mountPage()
    const selection = selectionOf(wrapper)
    selection.focusStyle('styles', 'one')
    await nextTick()
    wrapper.findComponent(Twin2dInspector).vm.$emit('pickPrim', 'p1')
    await nextTick()
    expect(wrapper.findComponent(Twin2dInspector).props('selectedPrim')).toBe(
      'p1',
    )

    selection.focusStyle('styles', 'two')
    await nextTick()

    expect(wrapper.findComponent(Twin2dInspector).props('selectedPrim')).toBe(
      '',
    )
  })
})

describe('卸载', () => {
  it('走的时候掐掉在途请求', () => {
    const wrapper = mountPage()

    wrapper.unmount()

    expect(controls.dispose).toHaveBeenCalledTimes(1)
  })
})
