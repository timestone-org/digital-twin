/**
 * @fileoverview 契约：项目设置弹窗按项目预填三档表单，`save` 抛出的品牌 blob
 * 剔掉留空项（留空 = 继承平台默认，不是设成空），三个权限位各自只控自己那块，
 * 主题的增删改原样转给父页面。
 *
 * ⚠ 打了 `Teleport` 桩之后，弹窗里的子组件在**父组件每次重渲染**时都会被重建，
 * 子组件自己的编辑态因此会丢——这是桩的行为，真 Teleport 下不会。所以下面的
 * 用例不跨父组件更新去攒子组件状态。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ProjectThemePayload } from '@dt/contracts'

import type { ProjectSummary } from '@/api/dashboardWire'
import CustomThemeManager from '@/pages/Home/components/CustomThemeManager.vue'
import ProjectSettingsDialog from '@/pages/Home/components/ProjectSettingsDialog.vue'

const PROJECT: ProjectSummary = {
  id: 'p1',
  name: 'A 园区',
  description: '园区能源',
  themeJson: { __base: 'dark-tech' },
  brandJson: { productName: '能源中心', logoUrl: 'https://x/logo.svg' },
  dashboardCount: 3,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
}

const THEMES: ProjectThemePayload[] = [
  {
    id: 'c1',
    name: '园区蓝',
    mode: 'dark',
    tokens: { accent: { primary: '#0af' } },
  },
]

function mountDialog(overrides: Record<string, unknown> = {}) {
  return mount(ProjectSettingsDialog, {
    props: {
      open: false,
      project: PROJECT,
      canUpdate: true,
      canDelete: true,
      canManageTheme: true,
      customThemes: THEMES,
      loading: false,
      themeBusy: false,
      ...overrides,
    },
    global: { stubs: { Teleport: true } },
  })
}

async function clickText(
  wrapper: ReturnType<typeof mountDialog>,
  label: string,
): Promise<void> {
  const hit = wrapper
    .findAll('button')
    .find((button) => button.text().includes(label))
  expect(hit, `没有文案含「${label}」的按钮`).toBeDefined()
  await hit?.trigger('click')
}

describe('预填', () => {
  it('打开时按项目填名称、描述与品牌', async () => {
    const wrapper = mountDialog()

    await wrapper.setProps({ open: true })

    expect(wrapper.findAll('input')[0]?.element.value).toBe('A 园区')
    expect(wrapper.find('textarea').element.value).toBe('园区能源')
    await clickText(wrapper, '品牌')
    expect(wrapper.text()).toContain('产品名称')
  })
})

describe('保存', () => {
  it('品牌里留空的项不写进 blob，避免把平台默认盖成空', async () => {
    const wrapper = mountDialog()
    await wrapper.setProps({ open: true })

    await clickText(wrapper, '保存设置')

    expect(wrapper.emitted('save')?.[0]?.[0]).toEqual({
      name: 'A 园区',
      description: '园区能源',
      themeJson: { __base: 'dark-tech' },
      brandJson: { productName: '能源中心', logoUrl: 'https://x/logo.svg' },
    })
  })

  it('项目默认主题选回内置默认时 themeJson 是空对象', async () => {
    const wrapper = mountDialog()
    await wrapper.setProps({
      open: true,
      project: { ...PROJECT, themeJson: {} },
    })

    await clickText(wrapper, '保存设置')

    expect(wrapper.emitted('save')?.[0]?.[0]).toMatchObject({ themeJson: {} })
  })

  it('名字清空后点不出 save', async () => {
    const wrapper = mountDialog()
    await wrapper.setProps({ open: true })
    await wrapper.findAll('input')[0]?.setValue('   ')

    await clickText(wrapper, '保存设置')

    expect(wrapper.emitted('save')).toBeUndefined()
  })
})

describe('三个权限位', () => {
  it('没有改项目的码时不给保存键', async () => {
    const wrapper = mountDialog({ canUpdate: false })
    await wrapper.setProps({ open: true })

    expect(wrapper.text()).not.toContain('保存设置')
  })

  it('没有删项目的码时整块危险区都不渲染', async () => {
    const wrapper = mountDialog({ canDelete: false })
    await wrapper.setProps({ open: true })

    expect(wrapper.text()).not.toContain('删除项目')
  })

  it('有删项目的码时点删除抛 request-delete', async () => {
    const wrapper = mountDialog()
    await wrapper.setProps({ open: true })

    await clickText(wrapper, '删除项目')

    expect(wrapper.emitted('request-delete')).toHaveLength(1)
  })

  it('没有管主题的码时不渲染自定义主题管理', async () => {
    const wrapper = mountDialog({ canManageTheme: false })
    await wrapper.setProps({ open: true })
    await clickText(wrapper, '主题')

    expect(wrapper.text()).not.toContain('新建主题')
  })
})

describe('自定义主题', () => {
  it('列出已有主题，并把删除原样转给父页面', async () => {
    const wrapper = mountDialog()
    await wrapper.setProps({ open: true })
    await clickText(wrapper, '主题')

    expect(wrapper.text()).toContain('园区蓝')
    await wrapper.find('[aria-label="删除主题"]').trigger('click')

    expect(wrapper.emitted('delete-theme')?.[0]?.[0]).toMatchObject({
      id: 'c1',
    })
  })

  // 主题管理器自身的编辑态由 CustomThemeManager.spec.ts 守；这里只钉转发这一层
  it('把管理器的 create 原样转成 create-theme', async () => {
    const wrapper = mountDialog()
    await wrapper.setProps({ open: true })
    const input = { name: '新配色', mode: 'dark', tokens: {} }

    wrapper.getComponent(CustomThemeManager).vm.$emit('create', input)

    expect(wrapper.emitted('create-theme')).toEqual([[input]])
  })

  it('把管理器的 update 连着主题 id 一起转成 update-theme', async () => {
    const wrapper = mountDialog()
    await wrapper.setProps({ open: true })
    const patch = { name: '改过的' }

    wrapper.getComponent(CustomThemeManager).vm.$emit('update', 'c1', patch)

    expect(wrapper.emitted('update-theme')).toEqual([['c1', patch]])
  })
})
