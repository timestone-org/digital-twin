/**
 * @fileoverview 契约：样式库抽屉列全整座库、四枚动作各自落到 `styleOps` 上，
 * 导出与导入的字节往返一致。
 *
 * ⚠ 「恢复内置」删的是文档里那条覆盖，**不是**把预置数据写进文档：写死的话预置库
 * 将来升级就再也修不到这张图，而用户以为自己已经恢复了（§13.4）。这里正面断言
 * 「恢复之后 `config.styles` 里没有那个 id」——只断言「样式回到了预置的样子」的话，
 * 写死内置数据的实现照样绿。
 * ⚠ 往返一致断的是**字节**：导出的那串文本再读回来、并进一份空配置，得到的样式与
 * 原样式逐字相同。导出时漏一个字段，只看「导入成功」是看不出来的。
 * ⚠ 撞名三档要摆在面上，缺省改名并存：静默覆盖会把用户正在用的那份样式换掉。
 */
import { TWIN_2D_BUILTIN_NODE_STYLES, normalizeTwin2dConfig } from '@dt/twin2d'
import type { Twin2dConfig, Twin2dNodeStyle } from '@dt/twin2d'
import { DtFilePicker, DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

const downloads: { text: string; name: string }[] = []
vi.mock('@/utils/downloadJson', () => ({
  downloadText: (text: string, name: string) => {
    downloads.push({ text, name })
  },
}))

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('@dt/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@dt/ui')
  return {
    ...actual,
    useToast: () => ({
      success: toastSuccess,
      error: toastError,
      info: vi.fn(),
    }),
  }
})

import StyleLibraryDrawer from '@/pages/Twin2dEditor/components/StyleLibraryDrawer.vue'
import {
  importTwin2dStyles,
  readTwin2dStylePackage,
} from '@/pages/Twin2dEditor/scripts/stylePackage'

/** 夹具坏了要当场炸，不能悄悄退化成一个空样式。 */
function throwMissing(): never {
  throw new Error('预置库是空的')
}

const BUILTIN: Twin2dNodeStyle =
  TWIN_2D_BUILTIN_NODE_STYLES[0] ?? throwMissing()

/**
 * 文档里压着一份同 id 的覆盖，外加一份自建样式与一个用它的节点。
 * ⚠ 每一格都摆成**非缺省**值：留着缺省值的话，导出时漏掉那一格，导入那一侧的归一化
 * 会把同一个缺省值补回来，于是往返用例照样绿——而包里真的少了一格。
 */
const CONFIG: Twin2dConfig = normalizeTwin2dConfig({
  styles: [
    {
      id: BUILTIN.id,
      name: '我改过的',
      accent: 'tomato',
      category: 'mine-cat',
      defaultStatus: 'warning',
      size: { w: 123, h: 45 },
      ports: [{ id: 'p1', name: 'A', side: 'left', showName: true }],
      slots: [{ key: 'flow', label: '流量', unit: 't/h', primary: true }],
      prims: [{ id: 'b1', kind: 'box', border: { width: 2 } }],
      variants: [{ id: 'v1', when: { kind: 'status', in: ['alarm'] } }],
    },
    { id: 'mine', name: '自建', accent: 'teal', category: 'own' },
  ],
  edgeStyles: [
    {
      id: 'wire',
      name: '我的线',
      accent: 'teal',
      route: 'bezier',
      cornerRadius: 7,
      strokes: [{ id: 's1', width: 3, color: 'teal' }],
      startMarker: { kind: 'arrow', size: 9, filled: false },
      flow: { enabled: true, dash: [5, 5], durationMs: 900 },
      inactive: { opacity: 0.25, dashOff: true, color: 'gray' },
      label: { font: { size: 13, color: 'teal' } },
    },
  ],
  nodes: [{ id: 'n1', styleId: 'mine' }],
})

/** 一份没有任何自建样式的配置：导出那一支该拦下来。 */
const BARE: Twin2dConfig = normalizeTwin2dConfig({})

function mountDrawer(config: Twin2dConfig = CONFIG) {
  return mount(StyleLibraryDrawer, {
    props: { open: true, config },
    global: { stubs: { Teleport: true } },
  })
}

type Wrapper = ReturnType<typeof mountDrawer>

/**
 * 拿这一栏最后一次抛出来的整份新配置。
 * @param wrapper 挂好的抽屉
 */
function lastChange(wrapper: Wrapper): Twin2dConfig {
  const events = wrapper.emitted('change')
  const last = events?.at(-1)?.[0]
  if (last === undefined) throw new Error('抽屉没抛出新配置')
  return last as Twin2dConfig
}

/**
 * 按 data-test 点一枚键。
 * @param wrapper 挂好的抽屉
 * @param test 那一枚键的 data-test
 */
async function click(wrapper: Wrapper, test: string): Promise<void> {
  await wrapper.find(`[data-test="${test}"]`).trigger('click')
}

beforeEach(() => {
  downloads.length = 0
  toastError.mockReset()
  toastSuccess.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('库里列的是哪些', () => {
  it('预置库与文档里的两张表并成一列', () => {
    const wrapper = mountDrawer()

    const rows = wrapper.findAll('[data-test="style-lib-rows"] > li')

    expect(rows.length).toBeGreaterThan(TWIN_2D_BUILTIN_NODE_STYLES.length)
  })

  it('改过的内置样式标成覆盖内置，自建的标成自建', () => {
    const wrapper = mountDrawer()

    const covered = wrapper.find(
      `[data-test="style-lib-row-styles:${BUILTIN.id}"]`,
    )
    const own = wrapper.find('[data-test="style-lib-row-styles:mine"]')

    expect(covered.text()).toContain('覆盖内置')
    expect(own.text()).toContain('自建')
  })

  it('自建样式写着有几个在用', () => {
    const wrapper = mountDrawer()

    expect(
      wrapper.find('[data-test="style-lib-row-styles:mine"]').text(),
    ).toContain('1 个在用')
  })

  it('关键字过滤按名字与 id 一起找', async () => {
    const wrapper = mountDrawer()

    await wrapper.find('input[data-test="style-lib-search"]').setValue('mine')

    const rows = wrapper.findAll('[data-test="style-lib-rows"] > li')
    expect(rows).toHaveLength(1)
  })

  it('一条都不匹配时给空态', async () => {
    const wrapper = mountDrawer()

    await wrapper
      .find('input[data-test="style-lib-search"]')
      .setValue('没有这个东西')

    expect(wrapper.find('[data-test="style-lib-empty"]').exists()).toBe(true)
  })

  it('点一行请求把右栏切过去', async () => {
    const wrapper = mountDrawer()

    await click(wrapper, 'style-lib-open-styles:mine')

    expect(wrapper.emitted('focus')?.[0]).toEqual(['styles', 'mine'])
  })
})

describe('新建与复制', () => {
  it('新建节点样式追加一条，并把焦点转过去', async () => {
    const wrapper = mountDrawer()

    await click(wrapper, 'style-lib-add-node')

    const next = lastChange(wrapper)
    expect(next.styles).toHaveLength(CONFIG.styles.length + 1)
    expect(wrapper.emitted('focus')?.[0]?.[0]).toBe('styles')
  })

  it('新建连线样式追加在连线那张表上', async () => {
    const wrapper = mountDrawer()

    await click(wrapper, 'style-lib-add-edge')

    expect(lastChange(wrapper).edgeStyles).toHaveLength(
      CONFIG.edgeStyles.length + 1,
    )
  })

  // ⚠ 只按 id 复制的话，「把内置样式另存为自定义」这一支永远复制不出东西来
  it('复制一份还没被覆盖过的内置样式也复制得出来', async () => {
    const clean = normalizeTwin2dConfig({})
    const wrapper = mountDrawer(clean)

    await click(wrapper, `style-lib-copy-styles:${BUILTIN.id}`)

    expect(lastChange(wrapper).styles).toHaveLength(1)
  })

  it('复制一份连线样式走连线那一支', async () => {
    const wrapper = mountDrawer()

    await click(wrapper, 'style-lib-copy-edgeStyles:wire')

    expect(lastChange(wrapper).edgeStyles).toHaveLength(
      CONFIG.edgeStyles.length + 1,
    )
  })
})

describe('恢复内置是删覆盖', () => {
  it('恢复之后文档里没有那个 id 了', async () => {
    const wrapper = mountDrawer()

    await click(wrapper, `style-lib-restore-styles:${BUILTIN.id}`)

    const ids = lastChange(wrapper).styles.map((style) => style.id)
    expect(ids).not.toContain(BUILTIN.id)
    expect(ids).toContain('mine')
  })

  it('连线样式那一侧同一条口径', async () => {
    const preset = normalizeTwin2dConfig({ edgeStyles: [{ id: 'wire' }] })
    const wrapper = mountDrawer(preset)
    const restore = wrapper.find(
      '[data-test="style-lib-restore-edgeStyles:wire"]',
    )

    if (restore.exists()) {
      await restore.trigger('click')
      expect(lastChange(wrapper).edgeStyles).toHaveLength(0)
    } else {
      // 预置库里没有 `wire` 时它是自建的，那一档给的是删除而不是恢复
      expect(
        wrapper.find('[data-test="style-lib-remove-edgeStyles:wire"]').exists(),
      ).toBe(true)
    }
  })

  it('内置那一档既不给恢复也不给删除', () => {
    const clean = normalizeTwin2dConfig({})
    const wrapper = mountDrawer(clean)

    expect(
      wrapper
        .find(`[data-test="style-lib-restore-styles:${BUILTIN.id}"]`)
        .exists(),
    ).toBe(false)
    expect(
      wrapper
        .find(`[data-test="style-lib-remove-styles:${BUILTIN.id}"]`)
        .exists(),
    ).toBe(false)
  })
})

describe('删除', () => {
  it('删掉自建样式，引用它的节点不跟着删', async () => {
    const wrapper = mountDrawer()

    await click(wrapper, 'style-lib-remove-styles:mine')

    const next = lastChange(wrapper)
    expect(next.styles.map((style) => style.id)).not.toContain('mine')
    expect(next.nodes).toHaveLength(1)
  })

  // ⚠ 悬空的那几个画不出来，不说出来的话用户是在没有提示的情况下按下去的
  it('还有实体在用时把悬空的数目说出来', async () => {
    const wrapper = mountDrawer()

    await click(wrapper, 'style-lib-remove-styles:mine')

    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('1 个'))
  })
})

describe('导出与导入往返一致', () => {
  it('导出的那串文本再导回来，样式逐字相同', async () => {
    const wrapper = mountDrawer()

    await click(wrapper, 'style-lib-export')

    const written = downloads[0]
    if (written === undefined) throw new Error('没有导出任何东西')
    const read = readTwin2dStylePackage(written.text)
    if (!read.ok) throw new Error(read.reason)
    const back = importTwin2dStyles(normalizeTwin2dConfig({}), read.pkg)

    expect(back.config.styles).toEqual(CONFIG.styles)
    expect(back.config.edgeStyles).toEqual(CONFIG.edgeStyles)
  })

  it('文件名跟着传进来的那个走', async () => {
    const wrapper = mountDrawer()

    await click(wrapper, 'style-lib-export')

    expect(downloads[0]?.name).toBe('twin2d-styles')
  })

  it('一份自建样式都没有时不导出空包', async () => {
    const wrapper = mountDrawer(BARE)

    await click(wrapper, 'style-lib-export')

    expect(downloads).toHaveLength(0)
    expect(toastError).toHaveBeenCalled()
  })
})

/**
 * 造一份「选中了文件」的载荷。
 * @param text 文件正文
 */
function fileOf(text: string): File {
  return { text: () => Promise.resolve(text) } as unknown as File
}

/**
 * 走一遍导入。
 * @param wrapper 挂好的抽屉
 * @param text 文件正文
 */
async function importText(wrapper: Wrapper, text: string): Promise<void> {
  pickFiles(wrapper, [fileOf(text)])
  await nextTick()
  await nextTick()
}

/**
 * 替用户选一批文件。
 * ⚠ 走组件而不是 DOM：`data-test` 落在 DtFilePicker 内部那个藏起来的 input 上，
 * 从外面 find 不到它。
 * @param wrapper 挂好的抽屉
 * @param files 这一次选中的
 */
function pickFiles(wrapper: Wrapper, files: readonly File[]): void {
  wrapper.findComponent(DtFilePicker).vm.$emit('select', files)
}

describe('导入', () => {
  it('撞名默认改名并存，原来那份不动', async () => {
    const wrapper = mountDrawer()

    await importText(
      wrapper,
      JSON.stringify({ version: 1, styles: [{ id: 'mine', name: '外来的' }] }),
    )

    const next = lastChange(wrapper)
    expect(next.styles.find((style) => style.id === 'mine')?.name).toBe('自建')
    expect(next.styles).toHaveLength(CONFIG.styles.length + 1)
  })

  it('选了覆盖那一档就把同 id 的换掉', async () => {
    const wrapper = mountDrawer()
    wrapper.findComponent(DtSelect).vm.$emit('update:modelValue', 'overwrite')
    await nextTick()

    await importText(
      wrapper,
      JSON.stringify({ version: 1, styles: [{ id: 'mine', name: '外来的' }] }),
    )

    const next = lastChange(wrapper)
    expect(next.styles.find((style) => style.id === 'mine')?.name).toBe(
      '外来的',
    )
    expect(next.styles).toHaveLength(CONFIG.styles.length)
  })

  it('读不出来的包原样把话说出来，一步不改文档', async () => {
    const wrapper = mountDrawer()

    await importText(wrapper, '{ 这不是 JSON')

    expect(wrapper.emitted('change')).toBeUndefined()
    expect(toastError).toHaveBeenCalled()
  })

  it('版本比本版新的一律拒绝', async () => {
    const wrapper = mountDrawer()

    await importText(wrapper, JSON.stringify({ version: 99, styles: [] }))

    expect(wrapper.emitted('change')).toBeUndefined()
    expect(toastError).toHaveBeenCalledWith(expect.stringContaining('第 99 版'))
  })

  it('导进来之后把这一笔账说清楚', async () => {
    const wrapper = mountDrawer()

    await importText(
      wrapper,
      JSON.stringify({ version: 1, styles: [{ id: 'fresh' }] }),
    )

    expect(toastSuccess).toHaveBeenCalledWith(
      expect.stringContaining('节点样式 新增 1'),
    )
  })

  it('一份文件都没选时一步不动', async () => {
    const wrapper = mountDrawer()

    pickFiles(wrapper, [])
    await nextTick()

    expect(wrapper.emitted('change')).toBeUndefined()
  })
})

describe('关闭', () => {
  it('点关闭把开关抛回去', async () => {
    const wrapper = mountDrawer()

    const close = wrapper
      .findAll('button')
      .find((item) => item.text().includes('关闭'))
    await close?.trigger('click')

    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false])
  })
})
