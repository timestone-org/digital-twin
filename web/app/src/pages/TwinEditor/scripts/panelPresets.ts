/**
 * @fileoverview 信息牌的整套外观预设：外观那三组有十几个开关，逐个试出一副协调的
 * 样子很费劲，预设把「一整套」变成一次点击。
 * ⚠ 预设只覆盖它列出的键，没列的原样留着——用户调过的宽度不该被换个风格抹掉。
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
  patch: Partial<TwinPanelStyle>
}

/**
 * 八套常用外观。刻意都不动 `accent` 与 `background`：主题色是用户按项目定的，
 * 换个版式就把它改掉，等于每次试样式都要重挑一次颜色。
 */
export const TWIN_PANEL_PRESETS: readonly TwinPanelPreset[] = [
  {
    id: 'plain-card',
    label: '简洁卡片',
    hint: '常规卡片，无动效，适合密集摆放',
    patch: {
      variant: 'card',
      orient: 'center',
      density: 'normal',
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
      orient: 'top',
      density: 'normal',
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
    hint: '半透底，压在模型上不挡视线',
    patch: {
      variant: 'glass',
      orient: 'center',
      density: 'normal',
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
    hint: '宽度自适应的小字标签，适合标很多点',
    patch: {
      variant: 'tag',
      orient: 'top',
      width: 0,
      density: 'compact',
      fontScale: 0.85,
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
    hint: '冷线细描配不对称切角，综合态势那一档',
    patch: {
      variant: 'precision',
      orient: 'top',
      width: 260,
      density: 'normal',
      columns: 2,
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
      orient: 'right',
      width: 240,
      density: 'normal',
      columns: 1,
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
    hint: '点阵底配开放式角标，设备监控那一档',
    patch: {
      variant: 'matrix',
      orient: 'top',
      width: 250,
      density: 'compact',
      columns: 2,
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
    hint: '宽体两列 + 满装饰，一张牌顶一块副屏',
    patch: {
      variant: 'precision',
      orient: 'center',
      width: 420,
      height: 220,
      density: 'loose',
      columns: 2,
      fontScale: 1.1,
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
