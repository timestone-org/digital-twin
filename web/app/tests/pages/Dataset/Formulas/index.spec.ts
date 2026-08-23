/**
 * @fileoverview 公式库页的行为契约：按分类分组、门禁、本地搜索，
 * 以及三件不可逆动作（停用 / 恢复预设 / 删除）各自的措辞与拦截。
 *
 * ⚠ 这一页的门禁与台账页**不同码**：`formula:manage` 与 `dataset:manage` 分家
 * 是刻意的——改一条库公式会同时改掉所有引用它的台账列（DATASET_DESIGN §9）。
 * 拿 dataset:manage 放行这一页的写入口，就是把那条判断悄悄作废。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import type { DatasetFormulaDef, DatasetFormulaUsage } from '@dt/contracts'
import { ERROR_CODES } from '@dt/contracts'
import { DtConfirmHost, DtToastHost, useConfirm, useToast } from '@dt/ui'

import { BizError } from '@/api/client'
import * as formulas from '@/api/datasetFormulas'
import FormulaFormDialog from '@/pages/Dataset/Formulas/components/FormulaFormDialog.vue'
import FormulasPage from '@/pages/Dataset/Formulas/index.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/formulas', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

const STAMP = '2026-01-01T00:00:00.000Z'

function def(over: Partial<DatasetFormulaDef> = {}): DatasetFormulaDef {
  return {
    id: 'f1',
    code: '折标煤',
    name: '折标煤',
    category: 'energy',
    expression: '{电耗} * 0.1229',
    params: [],
    description: '按 GB/T 2589 等价值口径',
    is_builtin: true,
    is_enabled: true,
    signature: '@折标煤(电耗)',
    created_at: STAMP,
    updated_at: STAMP,
    ...over,
  }
}

function usage(over: Partial<DatasetFormulaUsage> = {}): DatasetFormulaUsage {
  return {
    table_id: 't1',
    table_code: 'energy',
    table_name: '能耗台账',
    column_id: 'c1',
    column_key: '标煤',
    column_name: '折标煤量',
    formula: '@折标煤({电耗})',
    is_direct: true,
    ...over,
  }
}

function signIn(codes: string[]): void {
  const auth = useAuthStore()
  auth.user = {
    id: 'u1',
    username: 'alice',
    email: 'alice@example.com',
    full_name: null,
    avatar_url: null,
    phone: null,
    is_active: true,
    last_login_at: null,
    created_at: STAMP,
    updated_at: STAMP,
    role: { id: 'r1', name: 'admin', description: null, is_builtin: true },
    role_permissions: codes,
    direct_permissions: [],
    permissions: codes,
  }
  auth.accessToken = 'token'
}

beforeEach(() => {
  setActivePinia(createPinia())
  // ⚠ 视图偏好落在 localStorage 里，用例顺序是随机的，不清会互相串
  localStorage.clear()
  vi.spyOn(formulas, 'listDatasetFormulas').mockResolvedValue([def()])
  vi.spyOn(formulas, 'listDatasetFormulaUsages').mockResolvedValue([])
  vi.spyOn(formulas, 'updateDatasetFormula').mockResolvedValue({
    ...def(),
    usages: [],
  })
  vi.spyOn(formulas, 'restoreDatasetFormula').mockResolvedValue(def())
  vi.spyOn(formulas, 'deleteDatasetFormula').mockResolvedValue(undefined)
})

// ⚠ 必须自动卸载：确认框与吐司宿主 teleport 到 body 上
enableAutoUnmount(afterEach)

afterEach(() => {
  useToast().clear()
  useConfirm().resolve(false)
  vi.restoreAllMocks()
})

async function render(codes: string[]) {
  signIn(codes)
  const wrapper = mount(FormulasPage)
  await flushPromises()
  return wrapper
}

async function renderWithHosts(codes: string[]) {
  const wrapper = await render(codes)
  mount(DtConfirmHost)
  mount(DtToastHost)
  await flushPromises()
  return wrapper
}

/** 行内动作在页面里而不是 body 上——只有弹窗与吐司才 teleport 出去。 */
function hasAction(wrapper: VueWrapper, label: string): boolean {
  return wrapper.find(`button[aria-label="${label}"]`).exists()
}

async function click(wrapper: VueWrapper, label: string): Promise<void> {
  await wrapper.find(`button[aria-label="${label}"]`).trigger('click')
  await flushPromises()
}

/** 点确认框上文案**恰好等于**这几个字的那个按钮。 */
async function clickInConfirm(text: string): Promise<void> {
  const button = [...document.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === text,
  )
  button?.click()
  await flushPromises()
}

function inUse(message: string): BizError {
  return new BizError(ERROR_CODES.datasetFormulaInUse, message, 409, 'trace')
}

const MANAGE = ['formula:view', 'formula:manage']

describe('公式库页', () => {
  it('一行说清名称、调用写法、公式体与状态', async () => {
    const wrapper = await render(['formula:view'])
    expect(wrapper.text()).toContain('折标煤')
    expect(wrapper.text()).toContain('@折标煤(电耗)')
    expect(wrapper.text()).toContain('{电耗} * 0.1229')
    expect(wrapper.text()).toContain('预设')
  })

  it('按分类分组，组标题是分类的中文名', async () => {
    vi.mocked(formulas.listDatasetFormulas).mockResolvedValue([
      def(),
      def({ id: 'f2', code: '同比', name: '同比', category: 'trend' }),
    ])
    const wrapper = await render(['formula:view'])
    expect(wrapper.text()).toContain('能源')
    expect(wrapper.text()).toContain('趋势')
  })

  it('⚠ 认不出来的分类照原样显示，绝不把那条公式藏起来', async () => {
    vi.mocked(formulas.listDatasetFormulas).mockResolvedValue([
      def({ category: '厂里自定的' }),
    ])
    const wrapper = await render(['formula:view'])
    expect(wrapper.text()).toContain('厂里自定的')
    expect(wrapper.text()).toContain('折标煤')
  })

  it('停用的那条在列表上就看得出来', async () => {
    vi.mocked(formulas.listDatasetFormulas).mockResolvedValue([
      def({ is_enabled: false }),
    ])
    const wrapper = await render(['formula:view'])
    expect(wrapper.text()).toContain('已停用')
  })

  it('页面顶上先把爆炸半径说清楚：改一条，所有引用它的列即刻跟着变', async () => {
    const wrapper = await render(['formula:view'])
    expect(wrapper.text()).toContain('所有引用它的台账列即刻按新口径算')
  })

  it('只读账号看不到写入口，但被告知原因；「引用」照旧看得到', async () => {
    const wrapper = await render(['formula:view'])
    expect(wrapper.text()).not.toContain('新建公式')
    expect(hasAction(wrapper, '编辑公式')).toBe(false)
    expect(hasAction(wrapper, '停用公式')).toBe(false)
    expect(wrapper.find('[data-test="perm-readonly"]').exists()).toBe(true)
    // 波及面谁都该看得见：没权限改不等于不该知道改了会影响谁
    expect(hasAction(wrapper, '查看引用')).toBe(true)
  })

  it('⚠ dataset:manage 不蕴含 formula:manage：拿它进来照样没有写入口', async () => {
    const wrapper = await render(['formula:view', 'dataset:manage'])
    expect(wrapper.text()).not.toContain('新建公式')
    expect(hasAction(wrapper, '编辑公式')).toBe(false)
  })

  it('持 formula:manage 才出现新建与行内写入口', async () => {
    const wrapper = await render(MANAGE)
    expect(wrapper.text()).toContain('新建公式')
    expect(hasAction(wrapper, '编辑公式')).toBe(true)
    expect(hasAction(wrapper, '停用公式')).toBe(true)
  })

  it('⚠ 预设只给「恢复出厂口径」，没有删除——删掉之后没有恢复入口', async () => {
    const wrapper = await render(MANAGE)
    expect(hasAction(wrapper, '恢复出厂口径')).toBe(true)
    expect(hasAction(wrapper, '删除公式')).toBe(false)
  })

  it('自建的那条给删除，不给恢复', async () => {
    vi.mocked(formulas.listDatasetFormulas).mockResolvedValue([
      def({ is_builtin: false }),
    ])
    const wrapper = await render(MANAGE)
    expect(hasAction(wrapper, '删除公式')).toBe(true)
    expect(hasAction(wrapper, '恢复出厂口径')).toBe(false)
  })

  it('搜索在本地筛，不再发一次请求', async () => {
    vi.mocked(formulas.listDatasetFormulas).mockResolvedValue([
      def(),
      def({
        id: 'f2',
        code: '同比',
        name: '同比增长率',
        category: 'trend',
        description: '与上一周期同期相比',
        expression: 'PREV({本期}, 1)',
        signature: '@同比(本期)',
      }),
    ])
    const wrapper = await render(['formula:view'])
    const before = vi.mocked(formulas.listDatasetFormulas).mock.calls.length

    await wrapper.find('input[type="search"]').setValue('同比')
    await flushPromises()

    expect(wrapper.text()).toContain('同比增长率')
    expect(wrapper.text()).not.toContain('折标煤')
    expect(vi.mocked(formulas.listDatasetFormulas).mock.calls.length).toBe(
      before,
    )
  })

  it('搜不到与库是空的是两种空态，说的话不一样', async () => {
    const wrapper = await render(['formula:view'])
    await wrapper.find('input[type="search"]').setValue('查无此物')
    await flushPromises()
    expect(wrapper.text()).toContain('没有匹配的公式')

    vi.mocked(formulas.listDatasetFormulas).mockResolvedValue([])
    const empty = await render(['formula:view'])
    expect(empty.text()).toContain('公式库还是空的')
  })
})

describe('停用', () => {
  it('⚠ 先说清停用不是「藏起来」：引用它的表会连录入带重算一起报错', async () => {
    const wrapper = await renderWithHosts(MANAGE)
    await click(wrapper, '停用公式')
    expect(document.body.textContent).toContain('解析期失败')
    expect(document.body.textContent).toContain('录入')
  })

  it('确认之后才发请求，且发的是 is_enabled=false', async () => {
    const wrapper = await renderWithHosts(MANAGE)
    await click(wrapper, '停用公式')
    await clickInConfirm('停用')
    expect(formulas.updateDatasetFormula).toHaveBeenCalledWith('f1', {
      is_enabled: false,
    })
  })

  it('取消就什么都不发', async () => {
    const wrapper = await renderWithHosts(MANAGE)
    await click(wrapper, '停用公式')
    await clickInConfirm('取消')
    expect(formulas.updateDatasetFormula).not.toHaveBeenCalled()
  })

  it('⚠ 被 409 拦下时，后端点名的那几张台账留在页面上，且没有强制入口', async () => {
    vi.mocked(formulas.updateDatasetFormula).mockRejectedValue(
      inUse(
        '还有 2 个台账列在用这条公式（能耗台账、水耗台账），停用会让这些表的数据录入、导入与重算一起报错',
      ),
    )
    const wrapper = await renderWithHosts(MANAGE)
    await click(wrapper, '停用公式')
    await clickInConfirm('停用')
    expect(wrapper.text()).toContain('能耗台账、水耗台账')
    // 后端没有 force，界面就不许摆一个「仍然停用」
    expect(document.body.textContent).not.toContain('仍然停用')
  })

  it('启用不问：它只会让更多东西算得出来', async () => {
    vi.mocked(formulas.listDatasetFormulas).mockResolvedValue([
      def({ is_enabled: false }),
    ])
    const wrapper = await renderWithHosts(MANAGE)
    await click(wrapper, '启用公式')
    expect(formulas.updateDatasetFormula).toHaveBeenCalledWith('f1', {
      is_enabled: true,
    })
  })
})

describe('恢复出厂口径', () => {
  it('⚠ 确认框明写「启用开关不动」——恢复的是口径，不是开关', async () => {
    const wrapper = await renderWithHosts(MANAGE)
    await click(wrapper, '恢复出厂口径')
    expect(document.body.textContent).toContain('启用开关不动')
  })

  it('确认之后调恢复端点，且提示引用它的列要重算', async () => {
    const wrapper = await renderWithHosts(MANAGE)
    await click(wrapper, '恢复出厂口径')
    await clickInConfirm('恢复')
    expect(formulas.restoreDatasetFormula).toHaveBeenCalledWith('f1')
    expect(document.body.textContent).toContain('需重算')
  })
})

describe('恢复出厂口径失败', () => {
  it('不是「还有人用」那一类的失败，就只报一句，不占着页面', async () => {
    vi.mocked(formulas.restoreDatasetFormula).mockRejectedValue(
      new Error('boom'),
    )
    const wrapper = await renderWithHosts(MANAGE)
    await click(wrapper, '恢复出厂口径')
    await clickInConfirm('恢复')
    expect(document.body.textContent).toContain('请求失败')
    expect(wrapper.text()).not.toContain('知道了')
  })
})

describe('删除', () => {
  it('确认框说清后端会拦，且不给强制出口', async () => {
    vi.mocked(formulas.listDatasetFormulas).mockResolvedValue([
      def({ is_builtin: false }),
    ])
    const wrapper = await renderWithHosts(MANAGE)
    await click(wrapper, '删除公式')
    expect(document.body.textContent).toContain('没有强制删除的出口')
  })

  it('⚠ 被 409 拦下时同样把原因留在页面上', async () => {
    vi.mocked(formulas.listDatasetFormulas).mockResolvedValue([
      def({ is_builtin: false }),
    ])
    vi.mocked(formulas.deleteDatasetFormula).mockRejectedValue(
      inUse('删不了：库里的 @综合能耗 调用了它'),
    )
    const wrapper = await renderWithHosts(MANAGE)
    await click(wrapper, '删除公式')
    await clickInConfirm('删除')
    expect(wrapper.text()).toContain('@综合能耗 调用了它')
  })

  it('删成了就重新取一次数', async () => {
    vi.mocked(formulas.listDatasetFormulas).mockResolvedValue([
      def({ is_builtin: false }),
    ])
    const wrapper = await renderWithHosts(MANAGE)
    const before = vi.mocked(formulas.listDatasetFormulas).mock.calls.length
    await click(wrapper, '删除公式')
    await clickInConfirm('删除')
    expect(vi.mocked(formulas.listDatasetFormulas).mock.calls.length).toBe(
      before + 1,
    )
  })
})

describe('引用反查', () => {
  it('点「引用」才去查——它是一次真实的重新解析，不是列表里现成的字段', async () => {
    const wrapper = await render(['formula:view'])
    expect(formulas.listDatasetFormulaUsages).not.toHaveBeenCalled()
    await click(wrapper, '查看引用')
    expect(formulas.listDatasetFormulaUsages).toHaveBeenCalledWith(
      'f1',
      expect.anything(),
    )
  })

  it('列出台账、列名与那一列的公式，并标出「间接」', async () => {
    vi.mocked(formulas.listDatasetFormulaUsages).mockResolvedValue([
      usage(),
      usage({
        column_id: 'c2',
        column_name: '综合能耗',
        is_direct: false,
        formula: '@综合能耗({电耗})',
      }),
    ])
    const wrapper = await render(['formula:view'])
    await click(wrapper, '查看引用')
    expect(document.body.textContent).toContain('能耗台账')
    expect(document.body.textContent).toContain('折标煤量')
    expect(document.body.textContent).toContain('间接')
  })

  it('没人引用时说的是「改它不影响任何数据」，不是一句「暂无数据」', async () => {
    const wrapper = await render(['formula:view'])
    await click(wrapper, '查看引用')
    expect(document.body.textContent).toContain('还没有台账列在用它')
  })
})

describe('弹窗联动', () => {
  it('点「新建公式」开的是一张空表单', async () => {
    const wrapper = await render(MANAGE)
    const create = [...document.querySelectorAll('button')].find(
      (node) => node.textContent?.trim() === '新建公式',
    )
    create?.click()
    await flushPromises()
    expect(wrapper.findComponent(FormulaFormDialog).props('formula')).toBeNull()
  })

  it('点「编辑」开的是被点的那一条', async () => {
    const wrapper = await render(MANAGE)
    await click(wrapper, '编辑公式')
    expect(
      wrapper.findComponent(FormulaFormDialog).props('formula'),
    ).toMatchObject({ id: 'f1' })
  })

  it('保存成功后把弹窗给的那句回执报出来，并重新取一次数', async () => {
    const wrapper = await renderWithHosts(MANAGE)
    const before = vi.mocked(formulas.listDatasetFormulas).mock.calls.length
    wrapper
      .findComponent(FormulaFormDialog)
      .vm.$emit('saved', '库公式已更新。2 个台账列跟着它走')
    await flushPromises()
    expect(document.body.textContent).toContain('2 个台账列跟着它走')
    expect(vi.mocked(formulas.listDatasetFormulas).mock.calls.length).toBe(
      before + 1,
    )
  })

  it('「知道了」把拦截横幅收起来——它挡在列表上面', async () => {
    vi.mocked(formulas.updateDatasetFormula).mockRejectedValue(
      inUse('还有 2 个台账列在用这条公式（能耗台账）'),
    )
    const wrapper = await renderWithHosts(MANAGE)
    await click(wrapper, '停用公式')
    await clickInConfirm('停用')
    expect(wrapper.text()).toContain('还有 2 个台账列在用这条公式')
    // ⚠ 横幅在页面里而不是 body 上：确认框那套找法在这里找不到它
    const dismiss = wrapper
      .findAll('button')
      .find((node) => node.text().trim() === '知道了')
    await dismiss?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('还有 2 个台账列在用这条公式')
  })
})

describe('引用反查的取数三态', () => {
  it('取不到时说得出原因，而不是一片空白', async () => {
    vi.mocked(formulas.listDatasetFormulaUsages).mockRejectedValue(
      new Error('boom'),
    )
    const wrapper = await render(['formula:view'])
    await click(wrapper, '查看引用')
    expect(document.body.textContent).toContain('请求失败')
  })

  it('关掉之后弹窗就不在了，再开一次是干净的', async () => {
    vi.mocked(formulas.listDatasetFormulaUsages).mockResolvedValue([usage()])
    const wrapper = await render(['formula:view'])
    await click(wrapper, '查看引用')
    expect(document.body.textContent).toContain('能耗台账')
    await clickInConfirm('关闭')
    expect(document.body.textContent).not.toContain('能耗台账')
  })
})
