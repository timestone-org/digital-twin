/**
 * @fileoverview 信息牌八种风格变体的中文名。信息牌与部件详情卡片共用同一份：
 * 两处各写一份的话，同一个变体在两个面板上会叫两个名字。
 */
import { TWIN_PANEL_VARIANTS, type TwinPanelVariant } from '@dt/twin-config'

const VARIANT_LABELS: Readonly<Record<TwinPanelVariant, string>> = {
  card: '卡片',
  hud: '战术 HUD',
  glass: '玻璃',
  bracket: '角标',
  tag: '标牌',
  precision: '精密切角',
  forge: '熔铸导轨',
  matrix: '信号矩阵',
}

/** 下拉选项，顺序就是 `TWIN_PANEL_VARIANTS` 的文档序。 */
export const PANEL_VARIANT_OPTIONS = TWIN_PANEL_VARIANTS.map((value) => ({
  value,
  label: VARIANT_LABELS[value],
}))
