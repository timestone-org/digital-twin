/**
 * @fileoverview 契约：自定义卡片这一页的接线。三栏各就各位、取数三态挡在前面、
 * 左栏每个动作落到那几个纯函数上、右栏摆的是选中那一项的字段，以及两道未保存守卫。
 *
 * ⚠ 两道守卫缺一不可：站内跳转拦在 `onBeforeRouteLeave`，关标签页 / 刷新拦在
 * `useUnsavedGuard`。这一页的改动只在内存里，漏一道就是「改了半天，一走全没」。
 * ⚠ 取数与落库的行为归 `useCardEditorPage.test.ts`；这里换成一份手搓的页面状态，
 * 为的是把「加载中」「冲突」「出错」这几种界面分支逐个摆出来。
 */
import type { DashboardNodePayload } from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, nextTick, ref, shallowRef } from 'vue'
import type { Ref } from 'vue'

const guard = vi.hoisted(() => ({
  leave: null as (() => Promise<boolean>) | null,
}))
const stub = vi.hoisted(() => ({ page: {} }))
const push = vi.fn()

vi.mock('vue-router', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useRoute: () => ({
    path: '/dashboards/d1/edit/card/n1',
    params: { dashboardId: 'd1', nodeId: 'n1' },
    query: {},
  }),
  onBeforeRouteLeave: (fn: () => Promise<boolean>) => {
    guard.leave = fn
  },
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}))

const toastSuccess = vi.fn()
/** 确认框收到的那份文案，用来验「删格前说清了什么」。 */
interface AskInput {
  message?: string
}
const confirmAsk = vi.fn<(input: AskInput) => Promise<boolean>>()
vi.mock('@dt/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dt/ui')
  return {
    ...actual,
    useToast: () => ({
      success: toastSuccess,
      error: vi.fn(),
      info: vi.fn(),
    }),
    useConfirm: () => ({ ask: confirmAsk }),
  }
})

vi.mock('@/pages/CardEditor/scripts/useCardEditorPage', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '@/pages/CardEditor/scripts/useCardEditorPage',
  )
  return { ...actual, useCardEditorPage: () => stub.page }
})

import CardEditor from '@/pages/CardEditor/index.vue'
import FieldsPane from '@/pages/CardEditor/components/FieldsPane.vue'
import { CELLS_KEY, PARTS_KEY } from '@/pages/CardEditor/scripts/cardDraft'
import type { CardEditorPage } from '@/pages/CardEditor/scripts/useCardEditorPage'

const CONFIG = {
  title: '一组温度',
  [PARTS_KEY]: [{ kind: 'label' }, { kind: 'value' }],
  [CELLS_KEY]: [
    { label: '进水温度', unit: '℃' },
    { label: '回水温度', unit: '℃' },
  ],
}

function node(config: Record<string, unknown>): DashboardNodePayload {
  return {
    id: 'n1',
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: 'data-card',
    x: 0,
    y: 0,
    w: 420,
    h: 220,
    zIndex: 0,
    isVisible: true,
    configJson: config,
    createdAt: '',
    updatedAt: '',
    bindings: [],
  }
}

interface Controls {
  config: Ref<Record<string, unknown>>
  loading: Ref<boolean>
  error: Ref<string | null>
  conflict: Ref<string | null>
  isDirty: Ref<boolean>
  save: ReturnType<typeof vi.fn<() => Promise<boolean>>>
  load: ReturnType<typeof vi.fn<() => Promise<void>>>
  page: CardEditorPage
}

function makeControls(): Controls {
  const config = shallowRef<Record<string, unknown>>({ ...CONFIG })
  const loading = ref(false)
  const error = ref<string | null>(null)
  const conflict = ref<string | null>(null)
  const isDirty = ref(false)
  const found = ref(true)
  const save = vi.fn<() => Promise<boolean>>(() => Promise.resolve(true))
  const load = vi.fn<() => Promise<void>>(() => Promise.resolve())
  const page: CardEditorPage = {
    node: computed(() => (found.value ? node(config.value) : null)),
    loading,
    saving: ref(false),
    error: computed(() => error.value),
    conflict,
    isDirty,
    setConfig: (next) => {
      config.value = next
      isDirty.value = true
    },
    load,
    save,
    dispose: vi.fn(),
  }
  return { config, loading, error, conflict, isDirty, save, load, page }
}

let controls = makeControls()

// ⚠ `useUnsavedGuard` 把监听挂在全局 window 上，用例之间会互相串门：留一个脏着的
// 页面没拆，后面每一条「干净时不拦关页」都会被它拦下
const mounted: ReturnType<typeof mount>[] = []

async function mountPage() {
  const wrapper = mount(CardEditor, { global: { stubs: { Teleport: true } } })
  mounted.push(wrapper)
  // ⚠ 中栏渲染的是真模块，部件是异步组件：不等 `import()` 落地就是一串空注释
  await vi.dynamicImportSettled()
  await flushPromises()
  return wrapper
}

/** 左栏那些行取出来的文字。 */
function rowTexts(wrapper: ReturnType<typeof mount>, prefix: string) {
  return wrapper
    .findAll(`[data-test^="pick-${prefix}:"]`)
    .map((one) => one.text())
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
  push.mockReset()
  toastSuccess.mockReset()
  confirmAsk.mockReset()
  confirmAsk.mockResolvedValue(false)
})

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
})

describe('三栏骨架', () => {
  it('一进来就取一次数', async () => {
    await mountPage()

    expect(controls.load).toHaveBeenCalled()
  })

  it('左栏摆部件与格两组，右栏摆字段，中栏摆真模块', async () => {
    const wrapper = await mountPage()

    expect(rowTexts(wrapper, 'part')).toHaveLength(2)
    expect(rowTexts(wrapper, 'cell')).toEqual(['进水温度℃', '回水温度℃'])
    expect(wrapper.find('.dc-grid').exists()).toBe(true)
  })

  // ⚠ 部件表是卡片级的：中栏画出来的两格必须是同一份部件
  it('中栏按当前草稿画，两格共用同一份部件', async () => {
    const wrapper = await mountPage()

    expect(wrapper.findAll('.dc-cell')).toHaveLength(2)
    expect(wrapper.findAll('.dc-value')).toHaveLength(2)
  })

  it('部件行写的是档位的中文名，不是档名本身', async () => {
    const wrapper = await mountPage()

    expect(rowTexts(wrapper, 'part')[0]).not.toBe('label')
  })

  it('没配名称的格在左栏按行号称呼', async () => {
    controls.config.value = { ...CONFIG, [CELLS_KEY]: [{}] }
    const wrapper = await mountPage()

    expect(rowTexts(wrapper, 'cell')).toEqual(['第 1 格'])
  })
})

describe('取数三态', () => {
  it('加载中只转圈，不摆三栏', async () => {
    controls.loading.value = true
    const wrapper = await mountPage()

    expect(wrapper.find('.dc-grid').exists()).toBe(false)
  })

  it('出错时把话摆出来', async () => {
    controls.error.value = '这张大屏上没有这个卡片节点'
    const wrapper = await mountPage()

    expect(wrapper.text()).toContain('没有这个卡片节点')
  })

  // ⚠ 冲突排在错误前面：版本撞了还继续存就是拿旧的盖新的
  it('冲突时摆冲突那一条，压过普通错误', async () => {
    controls.conflict.value = '版本旧了，请重新加载'
    controls.error.value = '别的错'
    const wrapper = await mountPage()

    expect(wrapper.text()).toContain('版本旧了')
    expect(wrapper.text()).not.toContain('别的错')
  })
})

describe('左栏动作', () => {
  it('加部件落在末尾，并选中新加的那一件', async () => {
    const wrapper = await mountPage()

    await wrapper.find('[data-test="pick-part:0"]').trigger('click')
    const before = rowTexts(wrapper, 'part').length
    await wrapper
      .findAll('button')
      .filter((one) => one.text() === '加部件')[0]
      ?.trigger('click')
    await nextTick()

    expect(rowTexts(wrapper, 'part')).toHaveLength(before + 1)
  })

  it('加格时名字按序号起，免得一排「未命名」分不清', async () => {
    const wrapper = await mountPage()

    await wrapper
      .findAll('button')
      .filter((one) => one.text() === '加格')[0]
      ?.trigger('click')
    await nextTick()

    expect(rowTexts(wrapper, 'cell').at(-1)).toContain('点位 3')
  })

  it('上移把那一件挪上去一位', async () => {
    const wrapper = await mountPage()
    const before = rowTexts(wrapper, 'part')

    await wrapper.findAll('[aria-label="上移"]')[1]?.trigger('click')
    await nextTick()

    expect(rowTexts(wrapper, 'part')).toEqual([before[1], before[0]])
  })

  // ⚠ 到头了原样返回：绕回另一端在一列表里看着像「跳走了」
  it('第一件的上移按钮是灰的', async () => {
    const wrapper = await mountPage()

    expect(
      wrapper.findAll('[aria-label="上移"]')[0]?.attributes('disabled'),
    ).toBeDefined()
  })

  it('删部件把那一件去掉', async () => {
    const wrapper = await mountPage()

    await wrapper.findAll('[aria-label="删除部件"]')[0]?.trigger('click')
    await nextTick()

    expect(rowTexts(wrapper, 'part')).toHaveLength(1)
  })

  it('只剩一件时删按钮是灰的——一件都不剩的卡片是空白板', async () => {
    controls.config.value = { ...CONFIG, [PARTS_KEY]: [{ kind: 'label' }] }
    const wrapper = await mountPage()

    expect(
      wrapper.findAll('[aria-label="删除部件"]')[0]?.attributes('disabled'),
    ).toBeDefined()
  })
})

describe('删格', () => {
  // ⚠ 删中间一格之后，它之后每一格的绑定都会改喂前一格——必须先说清再删
  it('先问一句，说清后面的绑定会整体前移', async () => {
    const wrapper = await mountPage()

    await wrapper.findAll('[aria-label="删除格"]')[0]?.trigger('click')
    await flushPromises()

    expect(confirmAsk).toHaveBeenCalled()
    expect(confirmAsk.mock.calls[0]?.[0].message).toContain('前一格')
  })

  it('没答应就不删', async () => {
    const wrapper = await mountPage()

    await wrapper.findAll('[aria-label="删除格"]')[0]?.trigger('click')
    await flushPromises()

    expect(rowTexts(wrapper, 'cell')).toHaveLength(2)
  })

  it('答应了才删', async () => {
    confirmAsk.mockResolvedValue(true)
    const wrapper = await mountPage()

    await wrapper.findAll('[aria-label="删除格"]')[0]?.trigger('click')
    await flushPromises()

    expect(rowTexts(wrapper, 'cell')).toEqual(['回水温度℃'])
  })
})

describe('右栏字段', () => {
  it('选中部件时摆的是那一档的字段声明', async () => {
    const wrapper = await mountPage()

    await wrapper.find('[data-test="pick-part:1"]').trigger('click')
    await nextTick()

    const pane = wrapper.findComponent(FieldsPane)
    const schema: unknown = pane.props('schema')
    expect(Array.isArray(schema)).toBe(true)
    expect(pane.props('row')).toEqual({ kind: 'value' })
  })

  it('选中格时摆的是这一格的取值', async () => {
    const wrapper = await mountPage()

    await wrapper.find('[data-test="pick-cell:1"]').trigger('click')
    await nextTick()

    expect(wrapper.findComponent(FieldsPane).props('row')).toEqual({
      label: '回水温度',
      unit: '℃',
    })
  })

  it('改一个字段只改那一行的那一个键', async () => {
    const wrapper = await mountPage()

    await wrapper.find('[data-test="pick-cell:0"]').trigger('click')
    await nextTick()
    wrapper.findComponent(FieldsPane).vm.$emit('update', 'unit', 'kPa')
    await nextTick()

    expect(controls.config.value[CELLS_KEY]).toEqual([
      { label: '进水温度', unit: 'kPa' },
      { label: '回水温度', unit: '℃' },
    ])
  })
})

describe('保存与离开', () => {
  it('干净时保存按钮是灰的', async () => {
    const wrapper = await mountPage()

    expect(
      wrapper.find('[data-test="save-card"]').attributes('disabled'),
    ).toBeDefined()
  })

  it('存成功给一句提示', async () => {
    controls.isDirty.value = true
    const wrapper = await mountPage()

    await wrapper.find('[data-test="save-card"]').trigger('click')
    await flushPromises()

    expect(controls.save).toHaveBeenCalled()
    expect(toastSuccess).toHaveBeenCalled()
  })

  it('存失败不报「已保存」', async () => {
    controls.isDirty.value = true
    controls.save.mockResolvedValue(false)
    const wrapper = await mountPage()

    await wrapper.find('[data-test="save-card"]').trigger('click')
    await flushPromises()

    expect(toastSuccess).not.toHaveBeenCalled()
  })

  it('回大屏跳回这张屏的编辑页', async () => {
    const wrapper = await mountPage()

    await wrapper
      .findAll('button')
      .filter((one) => one.text() === '回大屏')[0]
      ?.trigger('click')

    expect(push).toHaveBeenCalledWith({
      name: 'dashboard-editor',
      params: { dashboardId: 'd1' },
    })
  })

  it('干净时站内跳转直接放行', async () => {
    await mountPage()

    expect(await guard.leave?.()).toBe(true)
  })

  // ⚠ 这一页的改动只在内存里：不拦就是「改了半天，一走全没」
  it('脏着站内跳转要先问一句', async () => {
    controls.isDirty.value = true
    await mountPage()

    expect(await guard.leave?.()).toBe(false)
    expect(confirmAsk).toHaveBeenCalled()
  })

  it('干净时关页不拦，脏着才拦', async () => {
    await mountPage()
    expect(isBlocked()).toBe(false)

    controls.isDirty.value = true
    await nextTick()

    expect(isBlocked()).toBe(true)
  })
})
