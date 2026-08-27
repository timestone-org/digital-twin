/**
 * @fileoverview 两套预设各真挂一遍：它声称的那几件是不是真画得出来；末尾一段把关键取值
 * 逐个对回参考仓 `feed-list` 的源码——预设是照设计文档写的，再拿预设去对那份文档是
 * 循环验证，只有对回源码才算数。
 *
 * ⚠ 预设的数据面（键集合、键序、颜色写法）在 `presets.test.ts`；这一份守的是
 * 「配出来的观感真画得出来」——预设写对了而模板没接那一档，两边都不报错。
 * ⚠ 期望表按 id 逐条对上，新增一套预设而忘了写期望时，这里当场红。
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Component from '../../../src/modules/info-feed/Component.vue'
import { FEED_SLOT_KEY } from '../../../src/modules/info-feed/feed'
import manifest from '../../../src/modules/info-feed/manifest'
import { INFO_FEED_PRESETS } from '../../../src/modules/info-feed/presets'
import { configDefaults } from '../../../src/shared/config'

const DEFAULTS = configDefaults(manifest.configSchema)

/**
 * 参考仓 `feed-list/index.ts` 里那几个 `default`，逐字抄自源码。
 * ⚠ 源码只有一个「次要文字字号」（`timeSize`），级别文字与时刻共用它；
 * 新模型拆成 `levelSize` 与 `timeSize` 两个旋钮，两者的缺省都从这一个数来。
 */
const SOURCE_DEFAULTS = {
  dotSize: 8,
  dotGlow: 6,
  textSize: 13,
  secondarySize: 12,
  rowBorderStyle: 'dotted',
  sortByRank: false,
  scrollSpeed: 3,
}

/**
 * 参考仓 `feed-list/Component.vue` 的 `.fl-row { padding: 7px 4px }`。
 * ⚠ 源码里这两个数是写死的，没有对应的配置字段；新模型把它们摆成两个旋钮，
 * 缺省与预设都得回到源码这一对数上，否则一眼就与参考仓的行距差一截。
 */
const SOURCE_ROW_PADDING = { y: 7, x: 4 }

/** 参考仓那四档行分隔线的档序，逐字取自 `feed-list/index.ts` 的 `options`。 */
const SOURCE_BORDER_ORDER = ['dotted', 'dashed', 'solid', 'none']

const WEATHER = [
  { level: 'blue', text: '蓝色', time: '08:00' },
  { level: 'red', text: '红色', time: '10:24' },
  { level: 'green', text: '解除', time: '11:00' },
  { level: 'orange', text: '橙色', time: '09:40' },
  { level: 'yellow', text: '黄色', time: '09:10' },
]

function preset(id: string): Record<string, unknown> {
  const found = INFO_FEED_PRESETS.find((item) => item.id === id)
  if (found === undefined) throw new Error(`没有这一套预设：${id}`)
  return found.config
}

function render(id: string, items: unknown = WEATHER) {
  return mount(Component, {
    props: {
      config: { ...DEFAULTS, ...preset(id) },
      values: { [FEED_SLOT_KEY]: items },
    },
  })
}

function styleOfRow(id: string, index: number): string {
  return render(id).findAll('.if-row')[index]?.attributes('style') ?? ''
}

describe('消息流那一套', () => {
  it('圆点、级别、正文、时刻四件都在，时刻排在正文之后', () => {
    const wrapper = render('feed-plain')
    const row = wrapper.get('.if-row')

    expect(row.classes()).toContain('if--border-dotted')
    expect(row.classes()).toContain('if--time-right')
    expect(row.find('.if-dot').exists()).toBe(true)
    expect(wrapper.findAll('.if-dot')).toHaveLength(5)
    expect(wrapper.findAll('.if-time')).toHaveLength(5)
    // 橙在这一套里认不出来，那一条只有圆点没有级别文字
    expect(wrapper.findAll('.if-level')).toHaveLength(4)
  })

  it('走内置档：橙认不出，级别文字只出得来四档', () => {
    const wrapper = render('feed-plain')

    expect(wrapper.findAll('.if-level').map((node) => node.text())).toEqual([
      '提示',
      '危险',
      '正常',
      '警告',
    ])
  })

  it('不重排：屏上的次序就是推送次序', () => {
    const wrapper = render('feed-plain')

    expect(wrapper.findAll('.if-text').map((node) => node.text())).toEqual([
      '蓝色',
      '红色',
      '解除',
      '橙色',
      '黄色',
    ])
  })
})

describe('气象预警那一套', () => {
  it('五档各有官方说法的级别文字，橙也认得出来', () => {
    const wrapper = render('weather-alert')

    expect(wrapper.findAll('.if-level').map((node) => node.text())).toEqual([
      '红色预警',
      '橙色预警',
      '黄色预警',
      '蓝色预警',
      '预警解除',
    ])
  })

  it('按级别重排：红橙黄蓝解除，与推送次序无关', () => {
    const wrapper = render('weather-alert')

    expect(wrapper.findAll('.if-text').map((node) => node.text())).toEqual([
      '红色',
      '橙色',
      '黄色',
      '蓝色',
      '解除',
    ])
  })

  it('五档的颜色逐行注入，橙是那一档调出来的中间色', () => {
    expect(styleOfRow('weather-alert', 0)).toContain('var(--state-danger)')
    expect(styleOfRow('weather-alert', 1)).toContain('color-mix(')
    expect(styleOfRow('weather-alert', 2)).toContain('var(--state-warning)')
    expect(styleOfRow('weather-alert', 3)).toContain('var(--state-info)')
    expect(styleOfRow('weather-alert', 4)).toContain('var(--state-success)')
  })
})

describe('关键取值逐条对回参考源码', () => {
  it('圆点直径与辉光就是源码那两个缺省', () => {
    const sizes = INFO_FEED_PRESETS.map((item) => [
      item.config.dotSize,
      item.config.dotGlow,
    ])

    expect(sizes).toEqual(
      INFO_FEED_PRESETS.map(() => [
        SOURCE_DEFAULTS.dotSize,
        SOURCE_DEFAULTS.dotGlow,
      ]),
    )
  })

  it('正文字号就是源码那一档，级别与时刻共用源码的次要字号', () => {
    const sizes = INFO_FEED_PRESETS.map((item) => [
      item.config.textSize,
      item.config.levelSize,
      item.config.timeSize,
    ])

    expect(sizes).toEqual(
      INFO_FEED_PRESETS.map(() => [
        SOURCE_DEFAULTS.textSize,
        SOURCE_DEFAULTS.secondarySize,
        SOURCE_DEFAULTS.secondarySize,
      ]),
    )
  })

  it('行内边距对回源码那句写死的 padding', () => {
    const pads = INFO_FEED_PRESETS.map((item) => [
      item.config.rowPadY,
      item.config.rowPadX,
    ])

    expect(pads).toEqual(
      INFO_FEED_PRESETS.map(() => [SOURCE_ROW_PADDING.y, SOURCE_ROW_PADDING.x]),
    )
  })

  it('分隔线取源码的缺省档，四档档序也与源码逐字相同', () => {
    const styles = INFO_FEED_PRESETS.map((item) => item.config.rowBorderStyle)
    const options = manifest.configSchema
      .find((field) => field.key === 'rowBorderStyle')
      ?.options?.map((option) => option.value)

    expect(styles).toEqual(
      INFO_FEED_PRESETS.map(() => SOURCE_DEFAULTS.rowBorderStyle),
    )
    expect(options).toEqual(SOURCE_BORDER_ORDER)
  })

  it('滚动秒数取公共字段的缺省，只有气象那一套把重排打开', () => {
    const scroll = INFO_FEED_PRESETS.map((item) => [
      item.config.scrollSpeed,
      item.config.sortByRank,
    ])

    expect(scroll[0]).toEqual([
      SOURCE_DEFAULTS.scrollSpeed,
      SOURCE_DEFAULTS.sortByRank,
    ])
    expect(scroll[1]).toEqual([SOURCE_DEFAULTS.scrollSpeed, true])
  })
})
