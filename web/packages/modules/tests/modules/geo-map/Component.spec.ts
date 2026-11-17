/** @fileoverview 离线地图几何、标记与配置契约。 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import Component from '../../../src/modules/geo-map/Component.vue'
import manifest from '../../../src/modules/geo-map/manifest'
import { project, regionViews } from '../../../src/modules/geo-map/geometry'

describe('地理地图', () => {
  it('按需载入真实组件', async () => {
    expect((await manifest.component()).default).toBe(Component)
  })
  it('中心点和缩放使用设计坐标', () => {
    expect(project(104, 35.5, {})).toEqual({ x: 500, y: 330 })
    expect(project(110, 35.5, { zoom: 1 }).x).toBe(542)
    expect(Number.isFinite(project(104, 100, {}).y)).toBe(true)
  })
  it('拒绝短环，支持单多边形与缺失中心', () => {
    const rows = regionViews(
      {
        features: [
          {
            properties: { name: '省份' },
            geometry: {
              type: 'Polygon',
              coordinates: [[[0, 0], ['bad'], [1, 1]]],
            },
          },
        ],
      },
      {},
    )
    expect(rows[0]?.path).toBe('')
    expect(rows[0]?.center).toBeNull()
    expect(regionViews(null, {})).toEqual([])
  })
  it('省级轮廓、高亮及站点点击正常', async () => {
    const wrapper = mount(Component, {
      props: {
        config: {
          title: '地图',
          highlightRegion: '安徽省',
          markers: [{ label: '阜阳卷烟厂', lng: 115.81, lat: 32.89 }],
        },
        values: {},
      },
    })
    expect(wrapper.findAll('path').length).toBe(35)
    expect(wrapper.findAll('.geo-map__highlight').length).toBe(1)
    await wrapper.get('[role="button"]').trigger('click')
    expect(wrapper.emitted('interaction')).toEqual([
      [{ event: 'click', value: '阜阳卷烟厂' }],
    ])
    await wrapper.setProps({
      config: { showCapitals: false, showCapitalLabel: false, markers: [{}] },
    })
    expect(wrapper.findAll('.geo-map__label')).toHaveLength(0)
    wrapper.unmount()
  })
})
