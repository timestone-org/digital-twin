/**
 * @fileoverview 契约：挑选器交出的是 `asset:` 引用，不是 URL。
 * ⚠ 交 URL 的话，存进大屏配置之后部署地址一换就 404，而没有任何一处会报错。
 * 另守三条：没选中不许确认（否则写进去一个空引用），取不到时要说出原因，
 * 删除必须二次确认（它删的是所有大屏共用的那份字节）。
 *
 * ⚠ 弹窗 teleport 到 body，断言一律查 `document.body`——查 wrapper 的话
 * 它永远是一对空的 teleport 注释，而「找不到」看着像组件没渲染。
 */
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DtConfirmHost, useConfirm } from '@dt/ui'

import AssetPickerDialog from '@/components/assets/AssetPickerDialog.vue'

const api = vi.hoisted(() => ({
  listAssets: vi.fn(),
  listAssetKinds: vi.fn(),
  uploadAsset: vi.fn(),
  deleteAsset: vi.fn(),
}))

vi.mock('@/api/assets', () => api)

const ID = '0192f0aa-0000-7000-8000-000000000001'

const ASSET = {
  id: ID,
  ref: `asset:${ID}`,
  kind: 'model' as const,
  name: '机组.glb',
  contentType: 'model/gltf-binary',
  sizeBytes: 2048,
  checksum: 'x',
  createdAt: '2026-08-15T00:00:00.000Z',
  createdBy: 'me',
}

// ⚠ 必须自动卸载：宿主 teleport 到 body，上一条不卸载就直接清 body 时，
// 下一次更新会撞上已被摘掉的 teleport 容器
enableAutoUnmount(afterEach)

// ⚠ 没结的确认框是单例队列上的一条，留着它下一条用例一 ask 就被顶掉，
// 表现是那一条随机地「点了删除没反应」
afterEach(() => {
  useConfirm().resolve(false)
})

async function render(open = true) {
  const wrapper = mount(AssetPickerDialog, {
    props: { modelValue: open, kind: 'model' as const },
    attachTo: document.body,
  })
  await flushPromises()
  return wrapper
}

function query(selector: string): HTMLElement {
  const found = document.body.querySelector(selector)
  if (!(found instanceof HTMLElement)) {
    throw new Error(`body 里没有 ${selector}`)
  }
  return found
}

/** 按文案找按钮。弹窗在 body 上，只能从那里找。 */
function buttonByText(text: string): HTMLElement {
  const found = [...document.body.querySelectorAll('button')].find(
    (item) => (item.textContent ?? '').trim() === text,
  )
  if (found === undefined) throw new Error(`没有文案为「${text}」的按钮`)
  return found
}

async function click(element: HTMLElement): Promise<void> {
  element.click()
  await flushPromises()
}

beforeEach(() => {
  vi.resetAllMocks()
  api.listAssetKinds.mockResolvedValue([
    {
      kind: 'model',
      label: '三维模型',
      contentTypes: ['model/gltf-binary'],
      maxBytes: 1024 * 1024,
    },
  ])
  api.listAssets.mockResolvedValue([ASSET])
})

describe('选用', () => {
  it('交出的是引用而不是地址', async () => {
    const wrapper = await render()
    await click(query('.dt-assets__item'))

    await click(buttonByText('选用'))

    expect(wrapper.emitted('pick')?.[0]?.[0]).toBe(`asset:${ID}`)
  })

  it('没选中时确认键是禁用的，不许写进一个空引用', async () => {
    const wrapper = await render()

    expect(buttonByText('选用').hasAttribute('disabled')).toBe(true)
    expect(wrapper.emitted('pick')).toBeUndefined()
  })

  it('选用之后把窗关上', async () => {
    const wrapper = await render()
    await click(query('.dt-assets__item'))

    await click(buttonByText('选用'))

    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])
  })
})

describe('打开与关闭', () => {
  it('关着时不去拉列表', async () => {
    await render(false)

    expect(api.listAssets).not.toHaveBeenCalled()
  })

  it('打开时按当前类型拉第一页', async () => {
    await render()

    expect(api.listAssets).toHaveBeenCalledWith('model', {
      limit: 50,
      offset: 0,
      q: '',
    })
  })

  it('取不到时把原因说出来，而不是留一块空白', async () => {
    api.listAssets.mockRejectedValue(new Error('后端挂了'))
    await render()

    expect(document.body.textContent).toContain('后端挂了')
  })

  it('没有素材时给的是「去传一个」而不是空列表', async () => {
    api.listAssets.mockResolvedValue([])
    await render()

    expect(document.body.textContent).toContain('还没有素材')
  })

  it('上限随类型目录一起显示，界面不自己写一份', async () => {
    await render()

    expect(document.body.textContent).toContain('1 MB')
  })
})

describe('删除', () => {
  it('要二次确认，取消则一个字节都不动', async () => {
    api.deleteAsset.mockResolvedValue(undefined)
    await render()
    mount(DtConfirmHost)
    await flushPromises()

    await click(query(`[aria-label="删除 ${ASSET.name}"]`))
    await click(buttonByText('取消'))

    // ⚠ 这个弹窗是「挑素材」用的，旁边就是垃圾桶；手一滑删掉的是所有大屏
    // 共用的那份字节，故这一条不是洁癖
    expect(api.deleteAsset).not.toHaveBeenCalled()
  })

  it('确认之后从列表里消失', async () => {
    api.deleteAsset.mockResolvedValue(undefined)
    await render()
    mount(DtConfirmHost)
    await flushPromises()

    await click(query(`[aria-label="删除 ${ASSET.name}"]`))
    await click(buttonByText('删除'))

    expect(api.deleteAsset).toHaveBeenCalledWith(ID)
    expect(document.body.textContent).toContain('还没有素材')
  })
})
