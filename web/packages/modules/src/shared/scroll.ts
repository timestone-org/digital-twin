/**
 * @fileoverview 列表与表格族的「自动滚动」公共配置：字段片段与读取。
 * 字段收在这里而不是各模块各写一份，免得同一个开关在两个模块里叫两个键。
 */
import type { ConfigField } from '@dt/contracts'

import { readBoolean, readNumber } from './config'

/** 每个条目经过视区的缺省秒数。 */
export const DEFAULT_SCROLL_SPEED = 3

const MIN_SCROLL_SPEED = 1
const MAX_SCROLL_SPEED = 30

/**
 * 生成「自动滚动」字段组：开关一个、速度一个，速度只在开着时显示。
 * @param defaultSpeed 速度的缺省值
 * @param group 属性面板里的分段标题，传空串则不分段
 */
export function scrollConfigFields(
  defaultSpeed = DEFAULT_SCROLL_SPEED,
  group = '滚动',
): ConfigField[] {
  const section = group === '' ? {} : { group }
  return [
    {
      key: 'autoScroll',
      label: '自动滚动',
      type: 'boolean',
      default: true,
      help: '内容超出时慢速垂直滚动；关掉改为原生滚动条手动滚。',
      ...section,
    },
    {
      key: 'scrollSpeed',
      label: '滚动速度（每项秒数）',
      type: 'range',
      default: defaultSpeed,
      min: MIN_SCROLL_SPEED,
      max: MAX_SCROLL_SPEED,
      step: 1,
      when: { key: 'autoScroll', in: [true] },
      help: '每个条目经过视区所需的秒数，越大越慢。',
      ...section,
    },
  ]
}

/** 一个模块的滚动设置。 */
export interface ScrollSettings {
  autoScroll: boolean
  /** 每项经过视区的秒数，恒为正。 */
  scrollSpeed: number
}

/**
 * 从整份配置里读滚动设置。
 * ⚠ 速度必须为正：0 或负数落到动画时长上是「一帧滚完」，看起来就是整列表在闪。
 * @param config 模块的整份配置
 * @param defaultSpeed 速度取不到时的回退
 */
export function readScrollSettings(
  config?: Record<string, unknown>,
  defaultSpeed = DEFAULT_SCROLL_SPEED,
): ScrollSettings {
  const speed = readNumber(config?.scrollSpeed, defaultSpeed)
  return {
    autoScroll: readBoolean(config?.autoScroll, true),
    scrollSpeed: speed > 0 ? speed : defaultSpeed,
  }
}
