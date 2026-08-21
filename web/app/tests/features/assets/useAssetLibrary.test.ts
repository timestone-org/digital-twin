/**
 * @fileoverview 契约：素材库的三条防护——列表加载防竞态、上传可中止、
 * 改名只换那一行。
 * ⚠ 都是「不报错的错」：竞态输了只表现为「点了图标却出模型」；中止漏了只表现为
 * 关掉弹窗之后还在偷偷传，传完往一个已经没人看的界面写状态；改名后重拉整页则会
 * 把「加载更多」取回来的后几页悄悄丢掉。
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
  renameAsset: vi.fn(),
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
    variants: [],
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
  const other = new File(['y'], 'b.glb', { type: 'model/gltf-binary' })

  it('传完把新素材放在最前，不重拉列表', async () => {
    api.listAssets.mockResolvedValue([asset('old')])
    api.uploadAsset.mockResolvedValue(asset('fresh'))
    const { library } = mountLibrary()
    await library.reload('model')

    await library.upload('model', [file])

    expect(library.assets.value.map((item) => item.id)).toEqual([
      'fresh',
      'old',
    ])
    expect(api.listAssets).toHaveBeenCalledTimes(1)
  })

  it('一批文件一个接一个传，不并发', async () => {
    const order: string[] = []
    api.uploadAsset.mockImplementation(async (_kind: string, one: File) => {
      order.push(`start:${one.name}`)
      await Promise.resolve()
      order.push(`end:${one.name}`)
      return asset(one.name)
    })
    const { library } = mountLibrary()
    await library.reload('model')

    await library.upload('model', [file, other])

    // ⚠ 串行不是洁癖：并发传几个几百 MB 的模型会把上行带宽分光，
    // 表现是每条进度都在爬而没有一条传得完
    expect(order).toEqual([
      'start:a.glb',
      'end:a.glb',
      'start:b.glb',
      'end:b.glb',
    ])
  })

  it('一条失败不拖垮整队，其余照传且失败那条留下原因', async () => {
    api.uploadAsset.mockImplementation((_kind: string, one: File) =>
      one.name === 'a.glb'
        ? Promise.reject(new Error('太大了'))
        : Promise.resolve(asset('b')),
    )
    const { library } = mountLibrary()
    await library.reload('model')

    const saved = await library.upload('model', [file, other])

    expect(saved.map((item) => item.id)).toEqual(['b'])
    const failed = library.uploads.value.find((job) => job.status === 'failed')
    expect(failed?.error).toBe('太大了')
  })

  it('中止之后既不写状态也不报错', async () => {
    const pending = deferred<Asset>()
    api.uploadAsset.mockImplementation(
      (
        _kind: string,
        _file: File,
        options: { signal: AbortSignal },
      ): Promise<Asset> =>
        pending.promise.then((value) => {
          if (options.signal.aborted) throw new Error('aborted')
          return value
        }),
    )
    const { library } = mountLibrary()
    const running = library.upload('model', [file])
    library.abort()
    pending.settle(asset('never'))

    expect(await running).toEqual([])
    expect(library.assets.value).toEqual([])
    expect(library.error.value).toBe('')
    // 中止是用户自己按的，队列整个清掉而不是留一行红字
    expect(library.uploads.value).toEqual([])
  })

  it('卸载即中止：不许往一个已经没人看的界面写状态', async () => {
    const pending = deferred<Asset>()
    api.uploadAsset.mockReturnValue(pending.promise)
    const { library, unmount } = mountLibrary()
    const running = library.upload('model', [file])
    unmount()
    pending.settle(asset('late'))
    await running

    expect(library.isUploading.value).toBe(false)
  })

  it('传到别的类型上时不插进当前这一页', async () => {
    api.listAssets.mockResolvedValue([asset('old')])
    api.uploadAsset.mockResolvedValue({ ...asset('pic'), kind: 'image' })
    const { library } = mountLibrary()
    await library.reload('model')

    await library.upload('image', [file])

    // 插进去的话，这一行会在「三维模型」页里一直显示到下次刷新
    expect(library.assets.value.map((item) => item.id)).toEqual(['old'])
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

describe('改名', () => {
  it('只换那一行，不重拉整页', async () => {
    api.listAssets.mockResolvedValue([asset('a', '旧名'), asset('b')])
    api.renameAsset.mockResolvedValue(asset('a', '新名'))
    const { library } = mountLibrary()
    await library.reload('model')

    expect(await library.rename('a', '新名')).toBe(true)

    expect(library.assets.value.map((item) => item.name)).toEqual(['新名', 'b'])
    // 重拉会把「加载更多」取回来的后几页一起丢掉
    expect(api.listAssets).toHaveBeenCalledTimes(1)
  })

  it('失败时列表原样留着，只报错', async () => {
    api.listAssets.mockResolvedValue([asset('a', '旧名')])
    api.renameAsset.mockRejectedValue(new Error('名字重了'))
    const { library } = mountLibrary()
    await library.reload('model')

    expect(await library.rename('a', '新名')).toBe(false)

    expect(library.assets.value.map((item) => item.name)).toEqual(['旧名'])
    expect(library.error.value).toBe('名字重了')
  })
})

describe('搜索', () => {
  it('换关键词从第一页重来，并把它带给服务端', async () => {
    api.listAssets.mockResolvedValue([asset('a')])
    const { library } = mountLibrary()
    await library.reload('model')

    await library.search('  机组  ')

    // 前后空白在这里收掉：`" "` 与「没搜」是同一个意思
    expect(api.listAssets).toHaveBeenLastCalledWith('model', {
      limit: 50,
      offset: 0,
      q: '机组',
    })
    expect(library.keyword.value).toBe('机组')
  })

  it('接着往下取时仍然带着关键词', async () => {
    api.listAssets.mockResolvedValue(
      Array.from({ length: 50 }, (_unused, index) => asset(`a${index}`)),
    )
    const { library } = mountLibrary()
    await library.reload('model')
    await library.search('泵')

    await library.loadMore()

    // ⚠ 丢了关键词的话，第二页会是「全部素材」的第 51～100 条，与第一页毫无关系
    expect(api.listAssets).toHaveBeenLastCalledWith('model', {
      limit: 50,
      offset: 50,
      q: '泵',
    })
  })
})
