/** @fileoverview 信息牌与部件详情共用的缺省外观及布局。 */
import type { TwinPanelStyle } from './types'

export const DEFAULT_PANEL_STYLE: Readonly<TwinPanelStyle> = Object.freeze({
  variant: 'matrix',
  orient: 'top',
  accent: '--accent-primary',
  background: '',
  width: 0,
  height: 0,
  columns: 1,
  density: 'compact',
  scan: true,
  corners: true,
  grid: false,
  fontScale: 1,
  scale: 1,
  animate: true,
  pulse: false,
})
