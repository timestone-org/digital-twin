/** @fileoverview 重新上传保留原模型身份，失败可见，取消不发布界面结果。 */
import { DtFilePicker, DtProgress } from '@dt/ui'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import type { Asset, UploadOptions } from '@/api/assets'
import AssetReplaceUpload from '@/pages/Assets/components/AssetReplaceUpload.vue'

const api = vi.hoisted(() => ({ replaceAssetFile: vi.fn() }))
vi.mock('@/api/assets', () => api)
enableAutoUnmount(afterEach)
afterEach(() => vi.resetAllMocks())
const asset: Asset = {
  id: '0192f0aa-0000-7000-8000-000000000001',
  ref: 'asset:0192f0aa-0000-7000-8000-000000000001',
  kind: 'model',
  name: '原模型.glb',
  contentType: 'model/gltf-binary',
  sizeBytes: 12,
  checksum: 'old',
  createdAt: '2026-08-15T00:00:00Z',
  createdBy: 'tester',
  variants: [],
}
const file = new File(['new model'], '不同名称.glb')

it('确认替换发送原素材与新文件，并展示百分比进度', async () => {
  let finish: ((value: Asset) => void) | undefined
  api.replaceAssetFile.mockImplementation(
    (_asset: Asset, _file: File, options: UploadOptions) => {
      options.onProgress?.({ loaded: 5, total: 10 })
      return new Promise<Asset>((resolve) => {
        finish = resolve
      })
    },
  )
  const wrapper = mount(AssetReplaceUpload, { props: { asset } })
  wrapper.findComponent(DtFilePicker).vm.$emit('select', [file])
  await flushPromises()
  const confirm = wrapper
    .findAll('button')
    .find((button) => button.text() === '确认替换')
  await confirm?.trigger('click')
  expect(api.replaceAssetFile).toHaveBeenCalledWith(
    asset,
    file,
    expect.any(Object),
  )
  expect(wrapper.findComponent(DtProgress).props('value')).toBe(50)
  expect(wrapper.text()).toContain('保留名称、ID 和大屏引用')
  finish?.({ ...asset, checksum: 'new' })
  await flushPromises()
  expect(wrapper.emitted('replaced')?.[0]?.[0]).toEqual({
    ...asset,
    checksum: 'new',
  })
})

it('失败显示原因，不声称替换成功', async () => {
  api.replaceAssetFile.mockRejectedValue(new Error('文件过大'))
  const wrapper = mount(AssetReplaceUpload, { props: { asset } })
  wrapper.findComponent(DtFilePicker).vm.$emit('select', [file])
  await flushPromises()
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '确认替换')
    ?.trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('文件过大')
  expect(wrapper.emitted('replaced')).toBeUndefined()
})

it('关闭组件中止上传，迟到的完成不更新页面', async () => {
  let options: UploadOptions | undefined
  let finish: ((value: Asset) => void) | undefined
  api.replaceAssetFile.mockImplementation(
    (_asset: Asset, _file: File, input: UploadOptions) => {
      options = input
      return new Promise<Asset>((resolve) => {
        finish = resolve
      })
    },
  )
  const wrapper = mount(AssetReplaceUpload, { props: { asset } })
  wrapper.findComponent(DtFilePicker).vm.$emit('select', [file])
  await flushPromises()
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '确认替换')
    ?.trigger('click')
  wrapper.unmount()
  expect(options?.signal?.aborted).toBe(true)
  finish?.(asset)
  await flushPromises()
  expect(wrapper.emitted('replaced')).toBeUndefined()
})
