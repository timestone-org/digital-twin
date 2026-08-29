/**
 * @fileoverview 子编辑器入口：脏着的时候先存再跳。
 *
 * ⚠ 这条守的是一次静默的数据丢失：子编辑器另开一页、直接落库，落库会推进大屏
 * 行版本，本页的本地草稿随即因版本对不上被丢弃。所以脏着直接跳走 = 用户回来时
 * 未保存的布局改动没了，而且全程没有任何提示。
 */
import type { ModuleManifest, ModuleSubEditor } from '@dt/contracts'
import { flushPromises, mount } from '@vue/test-utils'
import { computed, defineComponent, h, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

import type { DashboardEditor } from '@/composables/useDashboardEditor'
import { useOpenSubEditor } from '@/features/dashboard/editorContext'
import {
  openSubEditor,
  useSubEditorEntry,
} from '@/pages/DashboardEditor/scripts/useSubEditorEntry'

const SUB_EDITOR: ModuleSubEditor = {
  configKey: 'twin',
  routeName: 'twin-editor',
  label: '打开孪生编辑器',
}

interface Options {
  dirty?: boolean
  askAnswer?: boolean
  /** false = 保存失败，脏标记不清。 */
  saveClears?: boolean
  selectedId?: string | null
}

/** 父组件下发入口、子组件取用；返回入口与各路探针。 */
function mountPair(options: Options) {
  const dirty = ref(options.dirty ?? false)
  const ask = vi.fn().mockResolvedValue(options.askAnswer ?? true)
  const save = vi.fn().mockImplementation(() => {
    if (options.saveClears !== false) dirty.value = false
    return Promise.resolve()
  })
  const error = vi.fn()
  const opened = ref<(() => void) | null>(null)

  const Child = defineComponent({
    setup() {
      const opener = useOpenSubEditor()
      opened.value = () => opener?.(SUB_EDITOR)
      return () => null
    },
  })

  const Parent = defineComponent({
    setup() {
      useSubEditorEntry({
        dashboardId: () => 'dash-1',
        selectedId: computed(() =>
          options.selectedId === undefined ? 'node-1' : options.selectedId,
        ),
        isDirty: () => dirty.value,
        save,
        confirm: { ask },
        toast: { error },
      })
      return () => h(Child)
    },
  })

  mount(Parent)

  return {
    ask,
    save,
    error,
    open: async (): Promise<void> => {
      opened.value?.()
      // 入口内部是异步的：确认、保存、跳转各一拍
      await flushPromises()
    },
  }
}

beforeEach(() => {
  push.mockReset()
  push.mockResolvedValue(undefined)
})

describe('子编辑器入口', () => {
  it('不脏时直接跳，参数带上大屏与节点', async () => {
    const pair = mountPair({ dirty: false })

    await pair.open()

    expect(pair.ask).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith({
      name: 'twin-editor',
      params: { dashboardId: 'dash-1', nodeId: 'node-1' },
    })
  })

  it('脏着先问；用户不同意就不跳，也不存', async () => {
    const pair = mountPair({ dirty: true, askAnswer: false })

    await pair.open()

    expect(pair.save).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('脏着同意后先存再跳', async () => {
    const pair = mountPair({ dirty: true, askAnswer: true })

    await pair.open()

    expect(pair.save).toHaveBeenCalledOnce()
    expect(push).toHaveBeenCalledOnce()
  })

  // ⚠ 存失败还跳走的话，草稿照样会被后面的落库挤掉
  it('存没成功（还脏着）就不跳', async () => {
    const pair = mountPair({ dirty: true, askAnswer: true, saveClears: false })

    await pair.open()

    expect(push).not.toHaveBeenCalled()
  })

  it('没选中节点时什么也不做', async () => {
    const pair = mountPair({ selectedId: null })

    await pair.open()

    expect(push).not.toHaveBeenCalled()
  })

  // 路由名写错时 push 会抛；这里必须说出来，不能让按钮点了没反应
  it('路由不存在时给出提示', async () => {
    push.mockRejectedValue(new Error('No match'))
    const pair = mountPair({ dirty: false })

    await pair.open()

    expect(pair.error).toHaveBeenCalledWith(
      expect.stringContaining('twin-editor'),
    )
  })
})

describe('按节点开', () => {
  const NODE = { id: 'node-1', moduleType: 'demo' }

  /**
   * 一份只有必填项的清单。
   * @param subEditor 声明了子编辑器没有
   */
  function manifest(subEditor?: ModuleSubEditor): ModuleManifest {
    return {
      type: 'demo',
      displayName: '演示',
      category: '演示',
      chrome: 'bare',
      defaultSize: { width: 100, height: 100 },
      configSchema: [],
      bindings: [],
      preview: { config: {} },
      component: () => Promise.resolve({ default: { template: '<i />' } }),
      ...(subEditor === undefined ? {} : { subEditor }),
    }
  }

  /**
   * 一份只够 `openSubEditor` 用的编辑器替身。
   * @param nodes 画布上有哪些节点
   */
  function fakeEditor(nodes: readonly { id: string; moduleType: string }[]) {
    return {
      nodes: computed(() => nodes),
      select: vi.fn(),
      flush: vi.fn(),
    } as unknown as DashboardEditor & {
      select: ReturnType<typeof vi.fn>
      flush: ReturnType<typeof vi.fn>
    }
  }

  // ⚠ 先选中再进：动作层按选中项走，用户也得看见是哪一个被打开了
  it('先选中再进，且先把在飞的改动落下', () => {
    const editor = fakeEditor([NODE])
    const enter = vi.fn()

    openSubEditor(editor, () => manifest(SUB_EDITOR), enter, 'node-1')

    expect(editor.select).toHaveBeenCalledWith('node-1')
    expect(editor.flush).toHaveBeenCalled()
    expect(enter).toHaveBeenCalledWith(SUB_EDITOR)
  })

  // ⚠ 读**声明**不读模块类型：写死类型名的话第三方模块永远拿不到这条入口
  it('没有声明子编辑器的模块什么都不做', () => {
    const editor = fakeEditor([NODE])
    const enter = vi.fn()

    openSubEditor(editor, () => manifest(), enter, 'node-1')

    expect(enter).not.toHaveBeenCalled()
    expect(editor.select).not.toHaveBeenCalled()
  })

  it('节点已经不在了也不做', () => {
    const editor = fakeEditor([])
    const enter = vi.fn()

    openSubEditor(editor, () => manifest(SUB_EDITOR), enter, 'gone')

    expect(enter).not.toHaveBeenCalled()
  })
})
