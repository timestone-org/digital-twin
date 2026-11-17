/** @fileoverview 报告展示模块的宿主与配置透传。 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import Component from '../../../src/modules/report-view/Component.vue'
import manifest from '../../../src/modules/report-view/manifest'
import { configureReportHost } from '../../../src/modules/report-view/host'

afterEach(() => configureReportHost(null))
describe('报告展示节点', () => {
  it('组件按需加载且缺宿主明确说明', async () => {
    expect((await manifest.component()).default).toBe(Component)
    const wrapper = mount(Component, { props: { config: {}, values: {} } })
    expect(wrapper.text()).toContain('当前环境未提供报告展示能力')
    wrapper.unmount()
  })
  it('模板编码与刷新间隔透传给宿主', () => {
    const host = defineComponent({
      props: { templateCode: String, refreshSeconds: Number },
      template: '<p>{{ templateCode }} / {{ refreshSeconds }}</p>',
    })
    configureReportHost(host)
    const wrapper = mount(Component, {
      props: {
        config: {
          title: '最新报告',
          templateCode: ' green ',
          refreshSeconds: 9999,
        },
        values: {},
      },
    })
    expect(wrapper.text()).toContain('green / 3600')
    expect(wrapper.text()).toContain('最新报告')
    wrapper.unmount()
  })
})
