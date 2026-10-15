/**
 * @fileoverview 信息牌外观预设；切换只调整风格、装饰与动效，保留配色和布局。
 */
import type { TwinPanelStyle } from '@dt/twin-config'

/** 一个外观预设。`patch` 逐键浅合并进 `panel.style`。 */
export interface TwinPanelPreset {
  /** 稳定 id，用作按钮 key 与测试断言。 */
  id: string
  /** 按钮文案，2–5 字。 */
  label: string
  /** 一句话说明它长什么样。 */
  hint: string
  patch: Pick<
    TwinPanelStyle,
    'variant' | 'scan' | 'corners' | 'grid' | 'animate' | 'pulse'
  >
}

/**
 * 八套常用外观。刻意都不动 `accent` 与 `background`：主题色是用户按项目定的，
 * 换个版式就把它改掉，等于每次试样式都要重挑一次颜色。
 */
export const TWIN_PANEL_PRESETS: readonly TwinPanelPreset[] = [
  {
    id: 'plain-card',
    label: '简洁卡片',
    hint: '常规卡片，无动效，适合密集布局',
    patch: {
      variant: 'card',
      scan: false,
      corners: false,
      grid: false,
      animate: false,
      pulse: false,
    },
  },
  {
    id: 'tech-hud',
    label: '科技 HUD',
    hint: '带入场动画与锚点光环，适合少量重点位',
    patch: {
      variant: 'hud',
      scan: true,
      corners: false,
      grid: false,
      animate: true,
      pulse: true,
    },
  },
  {
    id: 'glass',
    label: '玻璃',
    hint: '半透明背景，适合叠加在模型上方',
    patch: {
      variant: 'glass',
      scan: false,
      corners: false,
      grid: false,
      animate: true,
      pulse: false,
    },
  },
  {
    id: 'mini-tag',
    label: '小标签',
    hint: '实心标题栏与细线边框，适合多点位标注',
    patch: {
      variant: 'tag',
      scan: false,
      corners: false,
      grid: false,
      animate: false,
      pulse: false,
    },
  },
  {
    id: 'precision',
    label: '精密切角',
    hint: '细线边框与不对称切角，适合综合态势展示',
    patch: {
      variant: 'precision',
      scan: true,
      corners: true,
      grid: true,
      animate: true,
      pulse: true,
    },
  },
  {
    id: 'forge',
    label: '熔铸导轨',
    hint: '左侧一条竖导轨，能源与产线主题',
    patch: {
      variant: 'forge',
      scan: false,
      corners: false,
      grid: true,
      animate: true,
      pulse: true,
    },
  },
  {
    id: 'matrix',
    label: '信号矩阵',
    hint: '点阵背景与开放式角标，适合设备监控',
    patch: {
      variant: 'matrix',
      scan: true,
      corners: true,
      grid: false,
      animate: true,
      pulse: false,
    },
  },
  {
    id: 'command-wall',
    label: '指挥大屏',
    hint: '网格底配完整装饰，适合重点设备监控',
    patch: {
      variant: 'precision',
      scan: true,
      corners: true,
      grid: true,
      animate: true,
      pulse: false,
    },
  },
]

/**
 * 当前样式命中了哪个预设；都不像时给 null（用户手调过）。
 * 只比预设列出的那几个键——没列的键本就允许各不相同。
 * @param style 当前样式
 */
export function matchedPanelPreset(style: TwinPanelStyle): string | null {
  const hit = TWIN_PANEL_PRESETS.find((preset) =>
    Object.entries(preset.patch).every(
      ([key, value]) => style[key as keyof TwinPanelStyle] === value,
    ),
  )
  return hit?.id ?? null
}
