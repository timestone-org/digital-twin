/**
 * @fileoverview 契约：上传队列面板要把「哪一个失败了、为什么」摆在明处。
 *
 * ⚠ 一次挑十个文件、其中一个超限时，把它悄悄丢掉的话用户只会发现「怎么少了
 * 一个」，而没有任何一处说过为什么——这份用例守的就是这条。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { UploadJob } from '@/features/assets/assetUploads'
import AssetUploadPanel from '@/pages/Assets/components/AssetUploadPanel.vue'

function job(over: Partial<UploadJob> = {}): UploadJob {
  return {
    id: 'upload-1',
    name: 'a.glb',
    kind: 'model',
    sizeBytes: 2048,
    loaded: 0,
    status: 'waiting',
    error: '',
    ...over,
  }
}

function render(jobs: UploadJob[], finished = 0) {
  return mount(AssetUploadPanel, { props: { jobs, finished } })
}

describe('上传队列面板', () => {
  it('队列空时整块不出现，不留一条空壳', () => {
    expect(render([]).text()).toBe('')
  })

  it('在传时给出已传 / 总共，且能整体取消', async () => {
    const wrapper = render([
      job({ status: 'uploading', loaded: 1024, sizeBytes: 2048 }),
    ])

    expect(wrapper.text()).toContain('1 KB / 2 KB')
    const cancel = wrapper
      .findAll('button')
      .find((n) => n.text() === '全部取消')
    await cancel?.trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('失败那条留在列表里并说出原因', () => {
    const wrapper = render(
      [job({ status: 'failed', error: '三维模型最大 256 MB' })],
      1,
    )

    expect(wrapper.text()).toContain('三维模型最大 256 MB')
  })

  it('全部结束之后取消换成清空', async () => {
    const wrapper = render([job({ status: 'done', loaded: 2048 })], 1)

    expect(wrapper.text()).toContain('已完成')
    const clear = wrapper.findAll('button').find((n) => n.text() === '清空')
    await clear?.trigger('click')
    expect(wrapper.emitted('clear')).toHaveLength(1)
  })

  it('大小为 0 的文件不把百分比算成 NaN', () => {
    const wrapper = render([job({ status: 'uploading', sizeBytes: 0 })])

    // NaN 会变成一个宽度非法的进度条：条不见了，而控制台一声不吭
    expect(wrapper.html()).not.toContain('NaN')
  })
})
