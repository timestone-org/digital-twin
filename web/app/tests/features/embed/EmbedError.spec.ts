/** @fileoverview 嵌入错误页必须把失败原因明确展示给宿主用户。 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import EmbedError from '@/features/embed/EmbedError.vue'

describe('EmbedError', () => {
  it('以 alert 呈现明确标题与后端无关的可读原因', () => {
    const wrapper = mount(EmbedError, {
      props: { message: '嵌入授权已失效，请重新加载' },
    })

    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toContain('嵌入页面无法打开')
    expect(alert.text()).toContain('嵌入授权已失效，请重新加载')
  })
})
