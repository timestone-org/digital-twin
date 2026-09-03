/**
 * @fileoverview 顶栏那句「第 3/8 个节点 · 已用 2m14s」。
 *
 * ⚠ 没有进度的话，一个跑三十分钟的训练与一个卡死的节点在界面上长得一模一样。
 */
import type { ModelingRun } from '@dt/contracts'

import { formatElapsed } from '@/utils/datetime'

/**
 * 一次运行现在跑到哪儿了。不在跑就给空串。
 *
 * @param run 正在盯的那次运行
 * @param now 自己走字的那个时钟——只靠轮询回包重算的话，两拍之间那一秒是不动的
 */
export function progressOf(run: ModelingRun | null, now: Date): string {
  if (run === null || run.status !== 'running') return ''
  const settled = run.nodes.filter(
    (node) => node.status !== 'pending' && node.status !== 'running',
  ).length
  const since = run.started_at
  const spent = since === null ? '' : ` · 已用 ${formatElapsed(since, now)}`
  return `第 ${settled + 1}/${run.nodes.length} 个节点${spent}`
}
