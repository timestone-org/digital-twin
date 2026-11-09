/** @fileoverview 素材详情：改了名没存时点页脚「关闭」要先问，页脚也给一个看得见的保存键。 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Asset } from '@/api/assets'
import AssetDetailDialog from '@/pages/Assets/components/AssetDetailDialog.vue'

const confirmAsk = vi.hoisted(() => vi.fn())
vi.mock('@dt/ui', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('@dt/ui')),
  useConfirm: () => ({ ask: confirmAsk }),
}))

const ASSET: Asset = {
  id: 'a1',
  ref: 'asset:a1',
  kind: 'icon',
  name: '泵.svg',
  contentType: 'image/svg+xml',
  sizeBytes: 10,
  checksum: 'x',
  createdAt: '2026-08-15T00:00:00.000Z',
  createdBy: 'me',
  variants: [],
}

afterEach(() => {
  confirmAsk.mockReset()
  document.body.innerHTML = ''
})

function buttonByText(text: string): HTMLElement | undefined {
  return [...document.body.querySelectorAll('button')].find(
    (one) => (one.textContent ?? '').trim() === text,
  )
}

async function renderDirty() {
  const wrapper = mount(AssetDetailDialog, {
    props: {
      modelValue: true,
      asset: ASSET,
      canManage: true,
      kindLabel: '图标',
      isRecompressing: false,
    },
    attachTo: document.body,
  })
  await flushPromises()
  const input = document.body.querySelector('input[type="text"]')
  if (!(input instanceof HTMLInputElement)) throw new Error('没有改名输入框')
  input.value = '新泵.svg'
  input.dispatchEvent(new Event('input'))
  await flushPromises()
  return wrapper
}

describe('AssetDetailDialog 的未存改名', () => {
  it('点关闭先问；不放弃就不关', async () => {
    confirmAsk.mockResolvedValue(false)
    const wrapper = await renderDirty()
    buttonByText('关闭')?.click()
    await flushPromises()
    expect(confirmAsk).toHaveBeenCalledOnce()
    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    wrapper.unmount()
  })

  it('页脚给出保存键，点了发改名', async () => {
    const wrapper = await renderDirty()
    buttonByText('保存名字')?.click()
    await flushPromises()
    expect(wrapper.emitted('rename')).toEqual([['新泵.svg']])
    wrapper.unmount()
  })
})
