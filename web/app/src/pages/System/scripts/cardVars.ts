/**
 * @fileoverview 卡片视图里「这一项当前不生效」的整卡口径，用户页与路由规则页共用。
 */

/**
 * 失效项整卡下沉，不描红边：红色留给状态标签与破坏性操作。
 * ⚠ 不用 opacity 表达失效——`--text-disabled` 已经压在对比度下限上，
 * 再乘一层就不合规。
 */
export const INACTIVE_CARD_VARS: Readonly<Record<string, string>> = {
  '--card-bg': 'var(--surface-sunken)',
  '--card-border': 'var(--border-subtle)',
}
