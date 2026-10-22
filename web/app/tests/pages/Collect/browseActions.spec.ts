/** @fileoverview 浏览续页、刷新和换源时的请求隔离。 */
import { defineComponent, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CollectBrowseResult } from '@dt/contracts'

import * as collect from '@/api/collect'
import {
  useBrowseTree,
  type BrowseTree,
} from '@/pages/Collect/scripts/useBrowseTree'

function page(name: string, token: string | null = null): CollectBrowseResult {
  return {
    items: [
      {
        address: name,
        name,
        is_variable: false,
        has_children: true,
        data_type: null,
      },
    ],
    continuation_token: token,
    has_more: token !== null,
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function render(): {
  tree: BrowseTree
  changeSource: () => void
  unmount: () => void
} {
  const source = ref('s1')
  let tree: BrowseTree | undefined
  const wrapper = mount(
    defineComponent({
      setup() {
        tree = useBrowseTree(() => source.value, ref(new Set<string>()))
        return () => null
      },
    }),
  )
  if (tree === undefined) throw new Error('missing tree')
  return {
    tree,
    changeSource: () => {
      source.value = 's2'
    },
    unmount: () => wrapper.unmount(),
  }
}

afterEach(() => vi.restoreAllMocks())

describe('浏览请求隔离', () => {
  it('后返回的旧数据源根页不能覆盖新源', async () => {
    const old = deferred<CollectBrowseResult>()
    vi.spyOn(collect, 'browseSource')
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(page('new'))
    const { tree, changeSource, unmount } = render()
    const first = tree.loadRoot()
    changeSource()
    await tree.loadRoot()
    old.resolve(page('old'))
    await first
    expect(tree.roots.value.map((node) => node.name)).toEqual(['new'])
    unmount()
  })

  it('根层分页按需续读，不自动追完目录，续页失败保留已加载节点', async () => {
    const browse = vi
      .spyOn(collect, 'browseSource')
      .mockResolvedValueOnce(page('first', 'cursor'))
    const { tree, unmount } = render()
    await tree.loadRoot()
    expect(browse).toHaveBeenCalledTimes(1)
    browse.mockRejectedValueOnce(new Error('offline'))
    await tree.loadMore(null)
    expect(tree.roots.value.map((node) => node.name)).toEqual(['first'])
    expect(tree.nextToken.value).toBe('cursor')
    browse.mockResolvedValueOnce(page('last'))
    await tree.loadMore(null)
    expect(tree.roots.value.map((node) => node.name)).toEqual(['first', 'last'])
    expect(tree.nextToken.value).toBeNull()
    expect(browse.mock.calls.at(-1)?.[3]).toEqual({
      continuationToken: 'cursor',
    })
    unmount()
  })

  it('文件夹续页前半选，全部加载后可全选，续页保留已勾选', async () => {
    const browse = vi
      .spyOn(collect, 'browseSource')
      .mockResolvedValueOnce(page('folder'))
    const { tree, unmount } = render()
    await tree.loadRoot()
    const first = page('v1', 'more')
    first.items[0] = {
      address: 'v1',
      name: 'v1',
      is_variable: true,
      has_children: false,
      data_type: 'float',
    }
    browse.mockResolvedValueOnce(first)
    await tree.expand('folder')
    await tree.toggle('v1')
    await flushPromises()
    expect(tree.states.get('folder')).toBe('some')
    const second = page('v2')
    second.items[0] = {
      address: 'v2',
      name: 'v2',
      is_variable: true,
      has_children: false,
      data_type: 'float',
    }
    browse.mockResolvedValueOnce(second)
    await tree.loadMore('folder')
    await tree.toggle('v2')
    await flushPromises()
    expect(tree.selected.value.has('v1')).toBe(true)
    expect(tree.states.get('folder')).toBe('all')
    unmount()
  })

  it('刷新作废在途批量勾选，旧子树不得重新勾回', async () => {
    vi.spyOn(collect, 'browseSource').mockResolvedValue(page('folder'))
    const subtree =
      deferred<Awaited<ReturnType<typeof collect.browseSubtree>>>()
    vi.spyOn(collect, 'browseSubtree').mockReturnValue(subtree.promise)
    const { tree, unmount } = render()
    await tree.loadRoot()
    const pending = tree.toggle('folder')
    await tree.loadRoot()
    subtree.resolve({
      items: [
        {
          parent: 'folder',
          address: 'old',
          name: 'old',
          is_variable: true,
          has_children: false,
          data_type: 'float',
        },
      ],
      is_truncated: false,
    })
    await pending
    expect(tree.selectedCount.value).toBe(0)
    unmount()
  })

  it('截断子树保留已有节点，继续分页后仍保留已选变量', async () => {
    const browse = vi
      .spyOn(collect, 'browseSource')
      .mockResolvedValueOnce(page('folder'))
    const variable = (name: string) => ({
      address: name,
      name,
      is_variable: true,
      has_children: false,
      data_type: 'float' as const,
    })
    vi.spyOn(collect, 'browseSubtree').mockResolvedValue({
      items: [{ ...variable('first'), parent: 'folder' }],
      is_truncated: true,
    })
    const { tree, unmount } = render()
    await tree.loadRoot()
    const outcome = await tree.toggle('folder')
    await flushPromises()
    expect(outcome.isWhole).toBe(false)
    expect(tree.states.get('folder')).toBe('some')
    expect(tree.roots.value[0]?.isIncomplete).toBe(true)
    browse.mockResolvedValueOnce({
      items: [variable('first'), variable('last')],
      continuation_token: null,
      has_more: false,
    })
    await tree.loadMore('folder')
    expect(tree.roots.value[0]?.children?.map((node) => node.name)).toEqual([
      'first',
      'last',
    ])
    expect(tree.selected.value.has('first')).toBe(true)
    await tree.toggle('last')
    await flushPromises()
    expect(tree.states.get('folder')).toBe('all')
    unmount()
  })

  it('子目录加载失败后可重试，旧失败请求不会掀翻根页', async () => {
    const browse = vi
      .spyOn(collect, 'browseSource')
      .mockResolvedValueOnce(page('folder'))
    const { tree, unmount } = render()
    await tree.loadRoot()
    browse.mockRejectedValueOnce(new Error('offline'))
    await tree.expand('folder')
    expect(tree.roots.value[0]?.error).not.toBeNull()
    expect(tree.error.value).toBeNull()
    browse.mockResolvedValueOnce({
      items: [],
      continuation_token: null,
      has_more: false,
    })
    await tree.expand('folder')
    expect(tree.roots.value[0]?.error).toBeNull()
    expect(tree.roots.value[0]?.hasChildren).toBe(false)
    unmount()
  })

  it('卸载中止浏览请求并丢弃返回', async () => {
    const pending = deferred<CollectBrowseResult>()
    const browse = vi
      .spyOn(collect, 'browseSource')
      .mockReturnValue(pending.promise)
    const { tree, unmount } = render()
    const loading = tree.loadRoot()
    unmount()
    expect(browse.mock.calls[0]?.[2]?.aborted).toBe(true)
    pending.resolve(page('late'))
    await loading
    expect(tree.roots.value).toEqual([])
  })
})
