/**
 * @fileoverview 文本族与 HTML、图片三种轻画法。
 *
 * ⚠ HTML 那两条是**安全边界**，不是版式偏好：沙箱一松，用户传上来的那份 HTML
 * 就跑在本站源上，能读这个源的存储、能替用户调接口。
 */
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import DocumentPreviewHtml from '@/pages/Knowledge/components/DocumentPreviewHtml.vue'
import DocumentPreviewImage from '@/pages/Knowledge/components/DocumentPreviewImage.vue'
import DocumentPreviewText from '@/pages/Knowledge/components/DocumentPreviewText.vue'

describe('文本原件的画法', () => {
  it('markdown 走真实节点，标题与表格都摆出来', () => {
    const wrapper = mount(DocumentPreviewText, {
      props: {
        kind: 'markdown',
        text: '# 运行说明\n\n| 参数 | 上限 |\n| --- | --- |\n| 温度 | 65 ℃ |\n',
      },
    })

    expect(wrapper.text()).toContain('运行说明')
    expect(wrapper.findAll('th').map((one) => one.text())).toEqual([
      '参数',
      '上限',
    ])
    expect(wrapper.find('pre').exists()).toBe(false)
  })

  it('⚠ 是 JSON 就排一次版：一行几万字摊在 pre 里，横滚条拖不动', () => {
    const wrapper = mount(DocumentPreviewText, {
      props: { kind: 'text', text: '{"a":1,"b":[2,3]}' },
    })

    expect(wrapper.find('pre').text()).toBe(
      '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}',
    )
  })

  it('排不出版就原样摆，不报错——那不是错，只是它不是 JSON', () => {
    const wrapper = mount(DocumentPreviewText, {
      props: { kind: 'text', text: '2026-09-04 10:00 泵 A 启动\n{ 不是 JSON' },
    })

    expect(wrapper.find('pre').text()).toContain('泵 A 启动')
  })

  it('⚠ 正文里的标签只当字看，一处 v-html 都不许有', () => {
    const wrapper = mount(DocumentPreviewText, {
      props: { kind: 'text', text: '<script>alert(1)</script>' },
    })

    expect(wrapper.find('pre').text()).toBe('<script>alert(1)</script>')
    expect(wrapper.find('script').exists()).toBe(false)
  })
})

describe('HTML 原件的画法', () => {
  it('⚠ 关进沙箱：srcdoc + 空 sandbox，一个 allow- 都不给', () => {
    const wrapper = mount(DocumentPreviewHtml, {
      props: {
        text: '<h1>接口说明</h1><script>alert(1)</script>',
        name: 'a.html',
      },
    })

    const frame = wrapper.find('iframe')
    // 空串即最严：给了 allow-scripts 脚本就活了，给了 allow-same-origin 源就回来了
    expect(frame.attributes('sandbox')).toBe('')
    expect(frame.attributes('srcdoc')).toContain('<h1>接口说明</h1>')
    // ⚠ 不能走 object URL：blob: 地址继承创建它的那个页面的源
    expect(frame.attributes('src')).toBeUndefined()
  })
})

describe('图片原件的画法', () => {
  const revoked: string[] = []
  let made = 0

  beforeEach(() => {
    revoked.length = 0
    made = 0
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: () => `blob:fake/i${(made += 1)}`,
      revokeObjectURL: (url: string) => revoked.push(url),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('字节转成 object URL 摆出来，文件名当 alt', () => {
    const wrapper = mount(DocumentPreviewImage, {
      props: { blob: new Blob(['png']), name: '管路示意图.png' },
    })

    expect(wrapper.find('img').attributes('src')).toBe('blob:fake/i1')
    expect(wrapper.find('img').attributes('alt')).toBe('管路示意图.png')
  })

  it('⚠ 换一张与卸载都要 revoke，否则翻几份就攒下几份整包', async () => {
    const wrapper = mount(DocumentPreviewImage, {
      props: { blob: new Blob(['png']), name: 'a.png' },
    })

    await wrapper.setProps({ blob: new Blob(['png2']) })
    expect(revoked).toEqual(['blob:fake/i1'])

    wrapper.unmount()
    expect(revoked).toEqual(['blob:fake/i1', 'blob:fake/i2'])
  })
})
