/**
 * @fileoverview 6 套内置主题的取值。`dark-tech` 逐项等于 tokens.scss 的 :root
 * （注入时只做 removeProperty），其余各套按色相整盘换色。
 */
import type { ThemeDefinition } from './themeTokens'

const DARK_TECH: ThemeDefinition = {
  id: 'dark-tech',
  name: '深色科技',
  mode: 'dark',
  isRootDefault: true,
  tokens: {
    surface: {
      base: '#010d1e',
      sunken: 'rgba(0, 0, 0, 0.25)',
      panel: 'rgba(0, 20, 50, 0.4)',
      raised: 'rgba(0, 80, 160, 0.15)',
      overlay: 'rgba(0, 10, 30, 0.9)',
    },
    border: {
      subtle: 'rgba(0, 206, 252, 0.12)',
      default: 'rgba(0, 206, 252, 0.18)',
      strong: '#2c5a8a',
      hover: 'rgba(0, 206, 252, 0.4)',
    },
    text: {
      primary: '#ffffff',
      secondary: 'rgba(255, 255, 255, 0.7)',
      disabled: 'rgba(255, 255, 255, 0.55)',
      title: '#daf9ff',
      inverse: '#010d1e',
      onEmphasis: '#011018',
    },
    accent: {
      primary: '#00cefc',
      secondary: '#45d3fd',
      onSurface: '#00cefc',
    },
    state: {
      success: '#14e144',
      warning: '#ffe400',
      danger: '#ff4d4f',
      // :root 把它写作 var(--accent-primary)，这里取解析后的同一个值
      info: '#00cefc',
      idle: '#7aa7be',
      offline: '#8a9aa6',
    },
    fx: {
      glowTitle: 'rgba(0, 206, 252, 0.4)',
      cornerColor: '#00deff',
      scanline: 'rgba(0, 0, 0, 0.04)',
      gridLine: 'rgba(0, 206, 252, 0.05)',
      scrim: 'rgba(0, 0, 0, 0.6)',
      shadowModal: '0 24px 64px -16px rgba(0, 0, 0, 0.7)',
      shadowMenu: '0 12px 32px rgba(0, 0, 0, 0.45)',
      shadowInset: 'inset 0 1px 2px rgba(0, 0, 0, 0.28)',
      sheen: 'rgba(255, 255, 255, 0.06)',
      transition: '0.5s ease',
    },
  },
}

const LIGHT: ThemeDefinition = {
  id: 'light',
  name: '浅色',
  mode: 'light',
  tokens: {
    surface: {
      base: '#f4f7fb',
      sunken: 'rgba(0, 0, 0, 0.04)',
      panel: 'rgba(255, 255, 255, 0.7)',
      raised: 'rgba(255, 255, 255, 0.85)',
      overlay: 'rgba(244, 247, 251, 0.95)',
    },
    border: {
      subtle: 'rgba(0, 120, 200, 0.18)',
      default: 'rgba(0, 120, 200, 0.22)',
      strong: '#bcd4e6',
      hover: 'rgba(0, 120, 200, 0.45)',
    },
    text: {
      primary: '#0a1a2b',
      secondary: 'rgba(10, 26, 43, 0.78)',
      disabled: 'rgba(10, 26, 43, 0.64)',
      title: '#075b73',
      // ⚠ 不是白：它是 warning 实心底上的前景色，而 warning 恒为高亮暖黄
      inverse: '#0a1a2b',
      onEmphasis: '#011018',
    },
    accent: {
      primary: '#0098c8',
      secondary: '#0077a8',
      // ⚠ 比 primary 深：同一个取值压在浅底上当文字只有 3.09:1
      onSurface: '#0077a8',
    },
    // ⚠ 实心底恒配深墨前景（--text-on-emphasis），故状态色即便在浅色里也保持
    // 高亮度；调暗会让按钮/标签上的前景色掉到 4.5:1 以下
    state: {
      success: '#17a44f',
      warning: '#d99400',
      danger: '#ef4444',
      info: '#0098c8',
      idle: '#56707f',
      offline: '#4f6472',
    },
    fx: {
      glowTitle: 'rgba(0, 152, 200, 0.22)',
      cornerColor: '#0098c8',
      scanline: 'rgba(0, 0, 0, 0.02)',
      gridLine: 'rgba(0, 120, 200, 0.06)',
      scrim: 'rgba(10, 26, 43, 0.35)',
      shadowModal: '0 24px 64px -16px rgba(10, 26, 43, 0.25)',
      shadowMenu: '0 12px 32px rgba(10, 26, 43, 0.16)',
      shadowInset: 'inset 0 1px 2px rgba(10, 26, 43, 0.12)',
      sheen: 'rgba(255, 255, 255, 0.55)',
      transition: '0.5s ease',
    },
  },
  extraVars: {
    '--neutral-fg-rgb': '10, 26, 43',
    // 四角辉光是深色科技风的装饰，浅底上只剩四个色块
    '--card-corner-display': 'none',
  },
}

const NEBULA_VIOLET: ThemeDefinition = {
  id: 'nebula-violet',
  name: '暗夜紫',
  mode: 'dark',
  tokens: {
    surface: {
      base: '#0a0a1e',
      sunken: 'rgba(0, 0, 0, 0.3)',
      panel: 'rgba(40, 30, 80, 0.4)',
      raised: 'rgba(90, 60, 180, 0.15)',
      overlay: 'rgba(10, 8, 28, 0.9)',
    },
    border: {
      subtle: 'rgba(157, 107, 255, 0.14)',
      default: 'rgba(157, 107, 255, 0.2)',
      strong: '#4a3a7a',
      hover: 'rgba(157, 107, 255, 0.42)',
    },
    text: {
      primary: '#f4f1ff',
      secondary: 'rgba(228, 222, 255, 0.72)',
      disabled: 'rgba(228, 222, 255, 0.56)',
      title: '#e7ddff',
      inverse: '#0a0a1e',
      onEmphasis: '#0a0520',
    },
    accent: {
      primary: '#9d6bff',
      secondary: '#6f7bff',
      onSurface: '#9d6bff',
    },
    state: {
      success: '#3ddc84',
      warning: '#ffc14d',
      danger: '#ff5d6c',
      info: '#9d6bff',
      idle: '#8a86b8',
      offline: '#8f8aa8',
    },
    fx: {
      glowTitle: 'rgba(157, 107, 255, 0.4)',
      cornerColor: '#b98bff',
      scanline: 'rgba(0, 0, 0, 0.05)',
      gridLine: 'rgba(157, 107, 255, 0.05)',
      scrim: 'rgba(0, 0, 0, 0.6)',
      shadowModal: '0 24px 64px -16px rgba(0, 0, 0, 0.7)',
      shadowMenu: '0 12px 32px rgba(0, 0, 0, 0.45)',
      shadowInset: 'inset 0 1px 2px rgba(0, 0, 0, 0.28)',
      sheen: 'rgba(255, 255, 255, 0.06)',
      transition: '0.5s ease',
    },
  },
  extraVars: { '--neutral-fg-rgb': '244, 241, 255' },
}

const EMERALD: ThemeDefinition = {
  id: 'emerald',
  name: '翡翠绿',
  mode: 'dark',
  tokens: {
    surface: {
      base: '#03140f',
      sunken: 'rgba(0, 0, 0, 0.3)',
      panel: 'rgba(6, 50, 36, 0.4)',
      raised: 'rgba(10, 90, 64, 0.15)',
      overlay: 'rgba(3, 18, 13, 0.9)',
    },
    border: {
      subtle: 'rgba(46, 230, 166, 0.14)',
      default: 'rgba(46, 230, 166, 0.2)',
      strong: '#1f5a4a',
      hover: 'rgba(46, 230, 166, 0.42)',
    },
    text: {
      primary: '#eafff7',
      secondary: 'rgba(220, 255, 242, 0.72)',
      disabled: 'rgba(220, 255, 242, 0.56)',
      title: '#c9ffe9',
      inverse: '#03140f',
      onEmphasis: '#01130d',
    },
    accent: {
      primary: '#2ee6a6',
      secondary: '#36d6c2',
      onSurface: '#2ee6a6',
    },
    state: {
      success: '#36e07f',
      warning: '#ffcb45',
      danger: '#ff5f6b',
      info: '#2ee6a6',
      idle: '#6f9a8a',
      offline: '#7f9a92',
    },
    fx: {
      glowTitle: 'rgba(46, 230, 166, 0.4)',
      cornerColor: '#2ee6a6',
      scanline: 'rgba(0, 0, 0, 0.05)',
      gridLine: 'rgba(46, 230, 166, 0.05)',
      scrim: 'rgba(0, 0, 0, 0.6)',
      shadowModal: '0 24px 64px -16px rgba(0, 0, 0, 0.7)',
      shadowMenu: '0 12px 32px rgba(0, 0, 0, 0.45)',
      shadowInset: 'inset 0 1px 2px rgba(0, 0, 0, 0.28)',
      sheen: 'rgba(255, 255, 255, 0.06)',
      transition: '0.5s ease',
    },
  },
  extraVars: { '--neutral-fg-rgb': '234, 255, 247' },
}

const LAVA_AMBER: ThemeDefinition = {
  id: 'lava-amber',
  name: '熔岩橙',
  mode: 'dark',
  tokens: {
    surface: {
      base: '#1a0d05',
      sunken: 'rgba(0, 0, 0, 0.3)',
      panel: 'rgba(60, 30, 12, 0.42)',
      raised: 'rgba(120, 60, 20, 0.16)',
      overlay: 'rgba(20, 9, 3, 0.9)',
    },
    border: {
      subtle: 'rgba(255, 138, 61, 0.14)',
      default: 'rgba(255, 138, 61, 0.2)',
      strong: '#6a3a1a',
      hover: 'rgba(255, 138, 61, 0.42)',
    },
    text: {
      primary: '#fff4ea',
      secondary: 'rgba(255, 235, 220, 0.74)',
      disabled: 'rgba(255, 235, 220, 0.58)',
      title: '#ffe0c4',
      inverse: '#1a0d05',
      onEmphasis: '#1a0a02',
    },
    accent: {
      primary: '#ff8a3d',
      secondary: '#ffb454',
      onSurface: '#ff8a3d',
    },
    state: {
      success: '#5fd98a',
      warning: '#ffe14d',
      danger: '#ff5246',
      info: '#ff8a3d',
      idle: '#b39a86',
      offline: '#a89484',
    },
    fx: {
      glowTitle: 'rgba(255, 138, 61, 0.4)',
      cornerColor: '#ff9b4d',
      scanline: 'rgba(0, 0, 0, 0.05)',
      gridLine: 'rgba(255, 138, 61, 0.05)',
      scrim: 'rgba(0, 0, 0, 0.6)',
      shadowModal: '0 24px 64px -16px rgba(0, 0, 0, 0.7)',
      shadowMenu: '0 12px 32px rgba(0, 0, 0, 0.45)',
      shadowInset: 'inset 0 1px 2px rgba(0, 0, 0, 0.28)',
      sheen: 'rgba(255, 255, 255, 0.06)',
      transition: '0.5s ease',
    },
  },
  extraVars: { '--neutral-fg-rgb': '255, 244, 234' },
}

const COBALT_DEEP: ThemeDefinition = {
  id: 'cobalt-deep',
  name: '钴蓝深海',
  mode: 'dark',
  tokens: {
    surface: {
      base: '#02091a',
      sunken: 'rgba(0, 0, 0, 0.3)',
      panel: 'rgba(10, 30, 70, 0.4)',
      raised: 'rgba(20, 60, 140, 0.16)',
      overlay: 'rgba(2, 9, 26, 0.9)',
    },
    border: {
      subtle: 'rgba(58, 123, 255, 0.14)',
      default: 'rgba(58, 123, 255, 0.2)',
      strong: '#234a7a',
      hover: 'rgba(58, 123, 255, 0.42)',
    },
    text: {
      primary: '#eef4ff',
      secondary: 'rgba(224, 234, 255, 0.72)',
      disabled: 'rgba(224, 234, 255, 0.56)',
      title: '#d4e4ff',
      inverse: '#02091a',
      onEmphasis: '#010a1c',
    },
    accent: {
      primary: '#3a7bff',
      secondary: '#4f9bff',
      onSurface: '#3a7bff',
    },
    state: {
      success: '#2fe08a',
      warning: '#ffce47',
      danger: '#ff5a6a',
      info: '#3a7bff',
      idle: '#6f86b0',
      offline: '#8090a8',
    },
    fx: {
      glowTitle: 'rgba(58, 123, 255, 0.4)',
      cornerColor: '#4f9bff',
      scanline: 'rgba(0, 0, 0, 0.05)',
      gridLine: 'rgba(58, 123, 255, 0.05)',
      scrim: 'rgba(0, 0, 0, 0.6)',
      shadowModal: '0 24px 64px -16px rgba(0, 0, 0, 0.7)',
      shadowMenu: '0 12px 32px rgba(0, 0, 0, 0.45)',
      shadowInset: 'inset 0 1px 2px rgba(0, 0, 0, 0.28)',
      sheen: 'rgba(255, 255, 255, 0.06)',
      transition: '0.5s ease',
    },
  },
  extraVars: { '--neutral-fg-rgb': '238, 244, 255' },
}

/** 默认主题，注册顺序即换肤器的展示顺序。 */
export const DEFAULT_PRESET = DARK_TECH

export const THEME_PRESETS: readonly ThemeDefinition[] = [
  DARK_TECH,
  LIGHT,
  NEBULA_VIOLET,
  EMERALD,
  LAVA_AMBER,
  COBALT_DEEP,
]
