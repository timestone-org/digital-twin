/**
 * @fileoverview 信息牌的整套外观预设：外观那一组有八个开关，逐个试出一副协调的
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
 * 四套常用外观。刻意都不动 `accent` 与 `background`：主题色是用户按项目定的，
 * 换个版式就把它改掉，等于每次试样式都要重挑一次颜色。
 */
export const TWIN_PANEL_PRESETS: readonly TwinPanelPreset[] = [
  {
    id: 'plain-card',
    label: '简洁卡片',
    hint: '常规卡片，无动效，适合密集摆放',
    patch: { variant: 'card', orient: 'center', animate: false, pulse: false },
  },
  {
    id: 'tech-hud',
    label: '科技 HUD',
    hint: '带入场动画与锚点光环，适合少量重点位',
    patch: { variant: 'hud', orient: 'top', animate: true, pulse: true },
  },
  {
    id: 'glass',
    label: '玻璃',
    hint: '半透底，压在模型上不挡视线',
    patch: { variant: 'glass', orient: 'center', animate: true, pulse: false },
  },
  {
    id: 'mini-tag',
    label: '小标签',
    hint: '宽度自适应的小字标签，适合标很多点',
    patch: {
      variant: 'tag',
      orient: 'top',
      width: 0,
      fontScale: 0.85,
      animate: false,
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
