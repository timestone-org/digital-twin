/**
 * @fileoverview 项目主题的取数与写回。
 * ⚠ 最要紧的一条是卸载之后不许再写状态。持有它的是 WorkbenchDialogs，**关掉设置
 * 弹窗并不会卸载它**——真正卸载的是切走整个工作台；那一刻在途的请求回来照样会写
 * items 与 busy，写进一棵已经没人看的树。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import type { ProjectThemePayload } from '@dt/contracts'

import * as themesApi from '@/api/projectThemes'
import { useProjectThemes } from '@/pages/Home/components/useProjectThemes'
import type { ProjectThemes } from '@/pages/Home/components/useProjectThemes'

const toastError = vi.fn()
vi.mock('@dt/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dt/ui')
  return {
    ...actual,
    useToast: () => ({
      success: vi.fn(),
      error: toastError,
      info: vi.fn(),
      warning: vi.fn(),
    }),
  }
})

function theme(id: string): ProjectThemePayload {
  return { id, name: `主题 ${id}`, mode: 'dark', tokens: {} }
}

/** 把组合式函数挂进一个真组件里，才拿得到 `onUnmounted`。 */
function host(projectId: string | null = 'p-1') {
  let api: ProjectThemes | null = null
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useProjectThemes(() => projectId)
        return () => h('div')
      },
    }),
  )
  if (api === null) throw new Error('组合式函数没挂上')
  return { wrapper, api: api as ProjectThemes }
}

beforeEach(() => {
  toastError.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('取数', () => {
  it('按当前项目拉，拉到什么就是什么', async () => {
    vi.spyOn(themesApi, 'listProjectThemes').mockResolvedValue([theme('t-1')])
    const { api } = host()
    await api.load()
    expect(themesApi.listProjectThemes).toHaveBeenCalledWith('p-1')
    expect(api.items.value).toHaveLength(1)
  })

  it('没选项目时一个请求都不发', async () => {
    const list = vi.spyOn(themesApi, 'listProjectThemes')
    const { api } = host(null)
    await api.load()
    expect(list).not.toHaveBeenCalled()
  })

  it('拉不到不算错，列表留空让设置弹窗其余两档照常能用', async () => {
    vi.spyOn(themesApi, 'listProjectThemes').mockRejectedValue(new Error('403'))
    const { api } = host()
    await api.load()
    expect(api.items.value).toEqual([])
    expect(toastError).not.toHaveBeenCalled()
  })
})

describe('写回', () => {
  it('加一套主题之后整组重拉，而不是就地往本地数组里塞', async () => {
    const create = vi
      .spyOn(themesApi, 'createProjectTheme')
      .mockResolvedValue(theme('t-9'))
    vi.spyOn(themesApi, 'listProjectThemes').mockResolvedValue([theme('t-9')])
    const { api } = host()

    await api.add({ name: '新主题', mode: 'dark', tokens: {} })

    expect(create).toHaveBeenCalledWith('p-1', {
      name: '新主题',
      mode: 'dark',
      tokens: {},
    })
    expect(themesApi.listProjectThemes).toHaveBeenCalledWith('p-1')
    expect(api.items.value.map((item) => item.id)).toEqual(['t-9'])
  })

  it('写失败报错，且不把列表清掉', async () => {
    vi.spyOn(themesApi, 'listProjectThemes').mockResolvedValue([theme('t-1')])
    const { api } = host()
    await api.load()

    vi.spyOn(themesApi, 'deleteProjectTheme').mockRejectedValue(
      new Error('没权限'),
    )
    await api.drop(theme('t-1'))

    expect(toastError).toHaveBeenCalled()
    expect(api.items.value).toHaveLength(1)
  })
})

describe('卸载之后不再写状态', () => {
  it('在途那次回来时组件已经拆了，就不写了', async () => {
    let settle: (rows: ProjectThemePayload[]) => void = () => undefined
    vi.spyOn(themesApi, 'listProjectThemes').mockReturnValue(
      new Promise<ProjectThemePayload[]>((resolve) => {
        settle = resolve
      }),
    )
    const { wrapper, api } = host()
    const pending = api.load()

    wrapper.unmount()
    settle([theme('t-late')])
    await pending
    await flushPromises()

    expect(api.items.value).toEqual([])
    // busy 也停在 true：`finally` 那一笔同样落在死实例上，哨兵要连它一起挡
    expect(api.busy.value).toBe(true)
  })
})
