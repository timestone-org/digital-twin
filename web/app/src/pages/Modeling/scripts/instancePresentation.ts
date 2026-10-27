/** @fileoverview 模型实例的训练状态展示。 */
import { BizError } from '@/api/client'
import { describeError } from '@/composables/useAsyncList'
const labels: Readonly<Record<string, string>> = {
  pending: '等待训练',
  running: '训练中',
  succeeded: '训练成功',
  failed: '训练失败',
  cancelled: '已取消',
  cancelling: '正在取消',
}
export function runLabel(status: string | undefined): string {
  return status ? (labels[status] ?? status) : '尚未训练'
}
export function isTraining(status: string | undefined): boolean {
  return status === 'pending' || status === 'running' || status === 'cancelling'
}

export function describeModelingError(caught: unknown): string {
  const summary = describeError(caught)
  if (!(caught instanceof BizError) || caught.details.length === 0)
    return summary
  const details = caught.details
    .slice(0, 8)
    .map(
      (item) =>
        `${item.field.replace('configuration.nodes.', '')}：${item.message}`,
    )
  const remaining = caught.details.length - details.length
  return `${summary}：${details.join('；')}${remaining > 0 ? `；另有 ${remaining} 项校验问题` : ''}`
}
