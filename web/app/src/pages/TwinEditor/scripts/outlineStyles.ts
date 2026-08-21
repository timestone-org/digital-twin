/**
 * @fileoverview 左栏两棵树（大纲 / 层级）共用的行内动作键样式串。
 * ⚠ 行容器必须带 `group`：动作键静息态隐藏，靠 group-hover / group-focus-within
 * 现身——键盘 Tab 到看不见的键是可用性缺陷，focus 现身的那半截不能省。
 */

/** 20px 裸图标键的底座：尺寸、圆角、取色、禁用态。 */
export const OUTLINE_ACT =
  'flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-disabled hover:text-accent-primary disabled:cursor-not-allowed disabled:opacity-30'

/**
 * 静息隐藏、悬停 / 键盘焦点现身的那半截。
 * 常驻键（eye-off 的警示态、选中行的动作键）不要拼它。
 */
export const OUTLINE_ACT_HIDDEN =
  'opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100'
