/**
 * @fileoverview 素材库页的行为契约。
 *
 * ⚠ 最要紧的三条：复制给的是 `asset:<uuid>` 引用而不是 URL（落 URL 的配置
 * 会在换部署地址那天集体 404，且没有任何一处报错）；删除必须二次确认（它不
 * 做引用检查）；取满一页一定要给出「加载更多」（否则第 51 个素材在界面上
 * 根本不存在，而列表看着完全正常）。
 */
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'

import { DtConfirmHost, DtToastHost, useConfirm, useToast } from '@dt/ui'

import type { Asset, AssetKindSpec } from '@/api/assets'
import AssetsPage from '@/pages/Assets/index.vue'
import { useAuthStore } from '@/stores/auth'
import * as clipboard from '@/utils/clipboard'

const api = vi.hoisted(() => ({
  listAssets: vi.fn(),
  listAssetKinds: vi.fn(),
  uploadAsset: vi.fn(),
  deleteAsset: vi.fn(),
}))

vi.mock('@/api/assets', () => api)

vi.mock('vue-router', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useRoute: () => ({ path: '/assets', query: {} }),
  RouterLink: { template: '<a><slot /></a>' },
}))

const KINDS: AssetKindSpec[] = [
  {
    kind: 'image',
    label: '图片',
    contentTypes: ['image/png'],
    maxBytes: 8 * 1024 * 1024,
  },
  {
    kind: 'model',
    label: '三维模型',
    contentTypes: ['model/gltf-binary'],
    maxBytes: 256 * 1024 * 1024,
  },
]

function asset(over: Partial<Asset> = {}): Asset {
  return {
    id: '0f9f0a2e-4a3b-4c1d-9f2e-8b7a6c5d4e3f',
    ref: 'asset:0f9f0a2e-4a3b-4c1d-9f2e-8b7a6c5d4e3f',
    kind: 'image',
    name: '厂区俯视图.png',
    contentType: 'image/png',
    sizeBytes: 2 * 1024 * 1024,
    checksum: 'abc',
    createdAt: '2026-08-15T02:00:00.000Z',
    createdBy: 'heyufan',
    ...over,
  }
}

/** 造一整页（PAGE_SIZE 条），用来验「取满一页才说明还有下一页」。 */
function fullPage(): Asset[] {
  return Array.from({ length: 50 }, (_unused, index) =>
    asset({
      id: `0f9f0a2e-4a3b-4c1d-9f2e-8b7a6c5d${String(index).padStart(4, '0')}`,
      ref: `asset:0f9f0a2e-4a3b-4c1d-9f2e-8b7a6c5d${String(index).padStart(4, '0')}`,
      name: `图 ${index}`,
    }),
  )
}

function signIn(codes: string[]): void {
  const auth = useAuthStore()
  auth.user = {
    id: 'u1',
    username: 'heyufan',
    permissions: codes,
    role_permissions: codes,
  } as never
  auth.accessToken = 'token'
}

beforeEach(() => {
  setActivePinia(createPinia())
  // 视图模式落在 localStorage 里，不清会跨用例串
  localStorage.clear()
  vi.resetAllMocks()
  api.listAssetKinds.mockResolvedValue(KINDS)
  api.listAssets.mockResolvedValue([asset()])
})

// 宿主 teleport 到 body，不自动卸载会撞上已被摘掉的容器
enableAutoUnmount(afterEach)

afterEach(() => {
  useToast().clear()
  useConfirm().resolve(false)
  vi.restoreAllMocks()
})

async function render(codes: string[] = ['asset:view', 'asset:manage']) {
  signIn(codes)
  const wrapper = mount(AssetsPage)
  await flushPromises()
  return wrapper
}

async function renderWithHosts(codes?: string[]) {
  const wrapper = await render(codes)
  mount(DtConfirmHost)
  mount(DtToastHost)
  await flushPromises()
  return wrapper
}

async function clickInConfirm(text: string): Promise<void> {
  const button = [...document.querySelectorAll('button')].find((node) =>
    node.textContent?.includes(text),
  )
  button?.click()
  await flushPromises()
}

describe('素材库页', () => {
  it('列出名称、大小、上传时间与上传人', async () => {
    const wrapper = await render()
    expect(wrapper.text()).toContain('厂区俯视图.png')
    expect(wrapper.text()).toContain('2 MB')
    expect(wrapper.text()).toContain('heyufan')
  })

  it('默认进图片类，且带上分页参数——不许无参数地只取默认那一页', async () => {
    await render()
    expect(api.listAssets).toHaveBeenCalledWith('image', {
      limit: 50,
      offset: 0,
    })
  })

  it('类型标签取服务端目录，不在前端另抄一份', async () => {
    const wrapper = await render()
    expect(wrapper.text()).toContain('三维模型')
  })

  it('上传的大小闸来自服务端的类型目录', async () => {
    const wrapper = await render()
    expect(wrapper.text()).toContain('单个文件最大 8 MB')
  })

  it('图片给出 /oss/ 上的预览地址', async () => {
    const wrapper = await render()
    expect(wrapper.find('img').attributes('src')).toBe(
      '/oss/images/0f9f0a2e-4a3b-4c1d-9f2e-8b7a6c5d4e3f',
    )
  })

  it('模型没有缩略图，画占位图标而不是一个碎图', async () => {
    api.listAssets.mockResolvedValue([
      asset({ kind: 'model', name: '主厂房.glb' }),
    ])
    const wrapper = await render()
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('主厂房.glb')
  })

  it('切类型会按新类型重新从第一页取', async () => {
    const wrapper = await render()
    const tab = wrapper
      .findAll('button')
      .find((node) => node.text().includes('三维模型'))
    await tab?.trigger('click')
    await flushPromises()
    expect(api.listAssets).toHaveBeenLastCalledWith('model', {
      limit: 50,
      offset: 0,
    })
  })

  it('复制的是 asset: 引用，不是 URL', async () => {
    const copy = vi.spyOn(clipboard, 'copyText').mockResolvedValue(true)
    const wrapper = await render()
    await wrapper.find('[aria-label="复制引用"]').trigger('click')
    await flushPromises()
    expect(copy).toHaveBeenCalledWith(
      'asset:0f9f0a2e-4a3b-4c1d-9f2e-8b7a6c5d4e3f',
    )
  })

  it('只读账号没有上传与删除入口', async () => {
    const wrapper = await render(['asset:view'])
    expect(wrapper.text()).not.toContain('上传素材')
    expect(wrapper.find('[aria-label="删除"]').exists()).toBe(false)
  })

  it('持 asset:manage 才出现上传与删除', async () => {
    const wrapper = await render()
    expect(wrapper.text()).toContain('上传素材')
    expect(wrapper.find('[aria-label="删除"]').exists()).toBe(true)
  })

  it('删除要二次确认，取消则什么都不做', async () => {
    const wrapper = await renderWithHosts()
    await wrapper.find('[aria-label="删除"]').trigger('click')
    await flushPromises()
    await clickInConfirm('取消')
    expect(api.deleteAsset).not.toHaveBeenCalled()
  })

  it('确认框里必须说清「删了不检查有没有人在用」', async () => {
    const wrapper = await renderWithHosts()
    await wrapper.find('[aria-label="删除"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('取不到')
  })

  it('确认后删掉并从列表里去掉', async () => {
    api.deleteAsset.mockResolvedValue(undefined)
    const wrapper = await renderWithHosts()
    await wrapper.find('[aria-label="删除"]').trigger('click')
    await flushPromises()
    await clickInConfirm('删除')
    expect(api.deleteAsset).toHaveBeenCalledWith(
      '0f9f0a2e-4a3b-4c1d-9f2e-8b7a6c5d4e3f',
    )
    expect(wrapper.text()).not.toContain('厂区俯视图.png')
  })

  it('不足一页就没有「加载更多」', async () => {
    const wrapper = await render()
    expect(wrapper.text()).not.toContain('加载更多')
  })

  it('取满一页就给出「加载更多」，点了按位移接着取', async () => {
    api.listAssets.mockResolvedValue(fullPage())
    const wrapper = await render()
    expect(wrapper.text()).toContain('加载更多')

    api.listAssets.mockResolvedValue([asset({ name: '第 51 张' })])
    const more = wrapper
      .findAll('button')
      .find((node) => node.text().includes('加载更多'))
    await more?.trigger('click')
    await flushPromises()

    expect(api.listAssets).toHaveBeenLastCalledWith('image', {
      limit: 50,
      offset: 50,
    })
    expect(wrapper.text()).toContain('第 51 张')
  })

  it('列表取不到时说出原因，而不是显示成一个空库', async () => {
    api.listAssets.mockRejectedValue(new Error('素材服务连不上'))
    const wrapper = await render()
    expect(wrapper.text()).toContain('素材服务连不上')
  })
})
