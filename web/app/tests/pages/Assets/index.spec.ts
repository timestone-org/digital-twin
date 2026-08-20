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
import * as download from '@/utils/downloadJson'

const api = vi.hoisted(() => ({
  listAssets: vi.fn(),
  listAssetKinds: vi.fn(),
  uploadAsset: vi.fn(),
  deleteAsset: vi.fn(),
  renameAsset: vi.fn(),
}))

vi.mock('@/api/assets', () => api)

// 三维查看器要真 WebGL，happy-dom 里没有；它自己那份用例在 components/ 下。
// ⚠ `__esModule` 不能省：异步组件先看这个标记才去取 default，缺了它 Vue 会把
// 整个模块当组件用，报出来的是一句与 three 毫无关系的 `__isTeleport` 错
vi.mock('@/pages/Assets/components/AssetModelViewer.vue', () => ({
  __esModule: true,
  default: { name: 'AssetModelViewer', template: '<div data-test="viewer" />' },
}))

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

/**
 * 点改名那颗保存键。它是图标键，只能按 aria-label 找。
 * ⚠ 别改回按文案找：这颗键没有文字，而弹窗页脚上另有一颗写着「删除」的，
 * 按文案找会点到隔壁去。
 */
async function clickSave(): Promise<void> {
  const button = document.querySelector('[aria-label="保存新名字"]')
  if (button instanceof HTMLElement) button.click()
  await flushPromises()
}

/**
 * 点最后一个同名按钮。
 * ⚠ 详情面的页脚上也有一个「删除」，而确认框挂得比它晚——按文案取第一个会点回
 * 提问的那个按钮，于是确认框被反复重开，看着像「点了确定没反应」。
 * @param text 按钮文案
 */
async function clickLast(text: string): Promise<void> {
  const buttons = [...document.querySelectorAll('button')].filter((node) =>
    node.textContent?.includes(text),
  )
  buttons.at(-1)?.click()
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
      q: '',
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
      q: '',
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
      q: '',
    })
    expect(wrapper.text()).toContain('第 51 张')
  })

  it('列表取不到时说出原因，而不是显示成一个空库', async () => {
    api.listAssets.mockRejectedValue(new Error('素材服务连不上'))
    const wrapper = await render()
    expect(wrapper.text()).toContain('素材服务连不上')
  })
})

describe('搜索', () => {
  it('敲完字（防抖到点）按关键词重取，并把空白收掉', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = await render()
      const box = wrapper.find('[aria-label="按名字搜索素材"]')
      await box.setValue('  机组  ')
      await vi.advanceTimersByTimeAsync(400)

      expect(api.listAssets).toHaveBeenLastCalledWith('image', {
        limit: 50,
        offset: 0,
        q: '机组',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('连着敲只发最后那一次', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = await render()
      const before = api.listAssets.mock.calls.length
      const box = wrapper.find('[aria-label="按名字搜索素材"]')
      await box.setValue('机')
      await box.setValue('机组')
      await vi.advanceTimersByTimeAsync(400)

      // ⚠ 不防抖的话每敲一个字都是一次请求，而慢的那次后返回还会把列表覆盖回去
      expect(api.listAssets.mock.calls.length - before).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('搜不到时的空态说的是「没搜着」而不是「这一类是空的」', async () => {
    vi.useFakeTimers()
    try {
      const wrapper = await render()
      api.listAssets.mockResolvedValue([])
      await wrapper.find('[aria-label="按名字搜索素材"]').setValue('查无此物')
      await vi.advanceTimersByTimeAsync(400)
      await flushPromises()

      expect(wrapper.text()).toContain('没有名字含「查无此物」的素材')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('详情与改名', () => {
  async function openDetail() {
    const wrapper = await renderWithHosts()
    await wrapper.find('[aria-label="预览"]').trigger('click')
    await flushPromises()
    return wrapper
  }

  it('点预览打开详情，里面有引用、校验和与内容类型', async () => {
    await openDetail()

    const text = document.body.textContent ?? ''
    expect(text).toContain('asset:0f9f0a2e-4a3b-4c1d-9f2e-8b7a6c5d4e3f')
    expect(text).toContain('image/png')
    expect(text).toContain('abc')
  })

  it('图片在详情里画的是 /oss/ 上的原件', async () => {
    await openDetail()

    const images = [...document.body.querySelectorAll('img')].map((node) =>
      node.getAttribute('src'),
    )
    expect(images).toContain('/oss/images/0f9f0a2e-4a3b-4c1d-9f2e-8b7a6c5d4e3f')
  })

  it('模型在详情里走三维查看器，而不是一个必然裂开的 img', async () => {
    api.listAssets.mockResolvedValue([
      asset({ kind: 'model', name: '主厂房.glb' }),
    ])
    await openDetail()

    expect(document.body.querySelector('[data-test="viewer"]')).not.toBeNull()
  })

  it('改名调 PATCH，并把这一行与详情的标题一起换掉', async () => {
    api.renameAsset.mockResolvedValue(asset({ name: '新名.png' }))
    const wrapper = await openDetail()

    const input = document.body.querySelector('input[type="text"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('没有改名输入框')
    input.value = '新名.png'
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    await clickSave()

    expect(api.renameAsset).toHaveBeenCalledWith(
      '0f9f0a2e-4a3b-4c1d-9f2e-8b7a6c5d4e3f',
      '新名.png',
    )
    expect(wrapper.text()).toContain('新名.png')
  })

  it('名字清空时保存键是禁用的，不许把一行素材改成没有名字', async () => {
    await openDetail()

    const input = document.body.querySelector('input[type="text"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('没有改名输入框')
    input.value = '   '
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    await clickSave()

    expect(api.renameAsset).not.toHaveBeenCalled()
  })

  it('没改动时不出现保存键——省得用户先分辨它为什么是灰的', async () => {
    await openDetail()

    expect(document.body.textContent).toContain('显示名')
    expect(document.querySelector('[aria-label="保存新名字"]')).toBeNull()
  })

  it('只读账号在详情里没有改名与删除', async () => {
    const wrapper = await render(['asset:view'])
    mount(DtConfirmHost)
    await wrapper.find('[aria-label="预览"]').trigger('click')
    await flushPromises()

    expect(document.body.textContent).not.toContain('显示名')
    expect(document.body.querySelector('input[type="text"]')).toBeNull()
  })
})

describe('上传与下载', () => {
  const file = new File(['x'], '新图.png', { type: 'image/png' })

  /** 直接把文件喂给选择器背后的 input——DtFilePicker 把它藏起来了。 */
  async function pickFile(wrapper: ReturnType<typeof mount>): Promise<void> {
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file] })
    await input.trigger('change')
    await flushPromises()
  }

  it('传完把新素材插在最前，并显示队列里那一条', async () => {
    api.uploadAsset.mockResolvedValue(asset({ id: 'fresh', name: '新图.png' }))
    const wrapper = await renderWithHosts()

    await pickFile(wrapper)

    expect(api.uploadAsset).toHaveBeenCalled()
    expect(wrapper.text()).toContain('新图.png')
    expect(wrapper.text()).toContain('上传队列')
  })

  it('上传失败时那一条留在队列里说出原因，而不是无声无息', async () => {
    api.uploadAsset.mockRejectedValue(new Error('图片最大 16 MB'))
    const wrapper = await renderWithHosts()

    await pickFile(wrapper)

    expect(wrapper.text()).toContain('图片最大 16 MB')
  })

  it('下载给的是 /oss/ 上的原件地址，不是引用串', async () => {
    const saved = vi.spyOn(download, 'downloadUrl').mockImplementation(() => {
      // 用例里不真的触发浏览器下载
    })
    const wrapper = await render()

    await wrapper.find('[aria-label="下载原件"]').trigger('click')

    expect(saved).toHaveBeenCalledWith(
      '/oss/images/0f9f0a2e-4a3b-4c1d-9f2e-8b7a6c5d4e3f',
      '厂区俯视图.png',
    )
  })

  it('详情里的三个动作落在正看着的那一个上', async () => {
    const copy = vi.spyOn(clipboard, 'copyText').mockResolvedValue(true)
    api.deleteAsset.mockResolvedValue(undefined)
    const wrapper = await renderWithHosts()
    await wrapper.find('[aria-label="预览"]').trigger('click')
    await flushPromises()

    await clickInConfirm('复制引用')
    expect(copy).toHaveBeenCalledWith(
      'asset:0f9f0a2e-4a3b-4c1d-9f2e-8b7a6c5d4e3f',
    )

    await clickInConfirm('删除')
    await clickLast('删除')
    expect(api.deleteAsset).toHaveBeenCalledWith(
      '0f9f0a2e-4a3b-4c1d-9f2e-8b7a6c5d4e3f',
    )
    // 删掉之后详情面必须跟着关：留着的话它显示的是一个已经不存在的素材
    expect(document.body.textContent).not.toContain('校验和')
  })
})
