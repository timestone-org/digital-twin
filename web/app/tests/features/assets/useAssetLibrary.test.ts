/**
 * @fileoverview 契约：素材库的两条防护——列表加载防竞态、上传可中止。
 * ⚠ 两条都是「不报错的错」：竞态输了只表现为「点了图标却出模型」，
 * 中止漏了只表现为关掉弹窗之后还在偷偷传，传完往一个已经没人看的界面写状态。
 */
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

import type { Asset, AssetKindSpec } from '@/api/assets'
import {
  useAssetLibrary,
  type AssetLibrary,
} from '@/features/assets/useAssetLibrary'

const api = vi.hoisted(() => ({
  listAssets: vi.fn(),
  listAssetKinds: vi.fn(),
  uploadAsset: vi.fn(),
  deleteAsset: vi.fn(),
}))

vi.mock('@/api/assets', () => api)

const KINDS: AssetKindSpec[] = [
  {
    kind: 'model',
    label: '三维模型',
    contentTypes: ['model/gltf-binary'],
    maxBytes: 1024,
  },
]

function asset(id: string, name = id): Asset {
  return {
    id,
    ref: `asset:${id}`,
    kind: 'model',
    name,
    contentType: 'model/gltf-binary',
    sizeBytes: 10,
    checksum: 'x',
    createdAt: '2026-08-15T00:00:00.000Z',
    createdBy: 'me',
  }
}

/** 一个能手动决定何时完成的 promise。 */
function deferred<T>() {
  let settle: (value: T) => void = () => undefined
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

function mountLibrary(): { library: AssetLibrary; unmount: () => void } {
  const captured: AssetLibrary[] = []
  const Host = defineComponent({
    setup() {
      captured.push(useAssetLibrary())
      return () => h('div')
    },
  })
  const wrapper = mount(Host)
  const library = captured[0]
  if (library === undefined) throw new Error('组合式函数没跑起来')
  return { library, unmount: () => wrapper.unmount() }
}

beforeEach(() => {
  vi.resetAllMocks()
  api.listAssetKinds.mockResolvedValue(KINDS)
  api.listAssets.mockResolvedValue([])
})

describe('列表加载防竞态', () => {
  it('慢的那次后返回时整个丢弃', async () => {
    const slow = deferred<Asset[]>()
    const fast = deferred<Asset[]>()
    api.listAssets
      .mockReturnValueOnce(slow.promise)
      .mockReturnValueOnce(fast.promise)
    const { library } = mountLibrary()

    const first = library.reload('model')
    const second = library.reload('icon')
    fast.settle([asset('new')])
    await second
    slow.settle([asset('old')])
    await first

    expect(library.assets.value.map((item) => item.id)).toEqual(['new'])
  })

  it('慢的那次失败也不许把新一次的列表清成错误态', async () => {
    const slow = deferred<Asset[]>()
    api.listAssets.mockReturnValueOnce(slow.promise)
    const { library } = mountLibrary()
    const first = library.reload('model')
    api.listAssets.mockResolvedValue([asset('new')])
    await library.reload('icon')
    slow.settle(Promise.reject(new Error('慢的那次炸了')) as never)
    await first.catch(() => undefined)

    expect(library.error.value).toBe('')
    expect(library.assets.value.map((item) => item.id)).toEqual(['new'])
  })
})

describe('类型目录', () => {
  it('只取一次：它是代码里的常量表', async () => {
    const { library } = mountLibrary()
    await library.reload('model')
    await library.reload('model')

    expect(api.listAssetKinds).toHaveBeenCalledTimes(1)
  })

  it('当前类型的登记信息跟着切', async () => {
    const { library } = mountLibrary()
    await library.reload('model')
    expect(library.spec.value?.kind).toBe('model')

    await library.reload('icon')
    expect(library.spec.value).toBeNull()
  })
})

describe('上传', () => {
  const file = new File(['x'], 'a.glb', { type: 'model/gltf-binary' })

  it('传完把新素材放在最前，不重拉列表', async () => {
    api.listAssets.mockResolvedValue([asset('old')])
    api.uploadAsset.mockResolvedValue(asset('fresh'))
    const { library } = mountLibrary()
    await library.reload('model')

    await library.upload('model', file)

    expect(library.assets.value.map((item) => item.id)).toEqual([
      'fresh',
      'old',
    ])
    expect(api.listAssets).toHaveBeenCalledTimes(1)
  })

  it('中止之后既不写状态也不报错', async () => {
    const pending = deferred<Asset>()
    api.uploadAsset.mockImplementation(
      (_kind: string, _file: File, _name: string, signal: AbortSignal) =>
        pending.promise.then((value) => {
          if (signal.aborted) throw new Error('aborted')
          return value
        }),
    )
    const { library } = mountLibrary()
    const running = library.upload('model', file)
    library.abort()
    pending.settle(asset('never'))

    expect(await running).toBeNull()
    expect(library.assets.value).toEqual([])
    expect(library.error.value).toBe('')
  })

  it('卸载即中止：不许往一个已经没人看的界面写状态', async () => {
    const pending = deferred<Asset>()
    api.uploadAsset.mockReturnValue(pending.promise)
    const { library, unmount } = mountLibrary()
    const running = library.upload('model', file)
    unmount()
    pending.settle(asset('late'))
    await running

    expect(library.isUploading.value).toBe(false)
  })

  it('失败时说出原因', async () => {
    api.uploadAsset.mockRejectedValue(new Error('太大了'))
    const { library } = mountLibrary()

    expect(await library.upload('model', file)).toBeNull()
    expect(library.error.value).toBe('太大了')
  })
})

describe('删除', () => {
  it('删成功即从列表里去掉', async () => {
    api.listAssets.mockResolvedValue([asset('a'), asset('b')])
    api.deleteAsset.mockResolvedValue(undefined)
    const { library } = mountLibrary()
    await library.reload('model')

    await library.remove('a')

    expect(library.assets.value.map((item) => item.id)).toEqual(['b'])
  })

  it('删失败时列表原样留着，只报错', async () => {
    api.listAssets.mockResolvedValue([asset('a')])
    api.deleteAsset.mockRejectedValue(new Error('删不掉'))
    const { library } = mountLibrary()
    await library.reload('model')

    await library.remove('a')

    expect(library.assets.value.map((item) => item.id)).toEqual(['a'])
    expect(library.error.value).toBe('删不掉')
  })
})
