/** @fileoverview 模型任务类型的展示名称与对应调用动作。 */
import type { ModelingTask } from '@dt/contracts'
import type { ModelingServingAction } from '@/api/modelingServing'

const TASK_LABELS: Readonly<Record<ModelingTask, string>> = {
  regression: '回归',
  classification: '分类',
  anomaly_detection: '异常检测',
  rule_calculation: '规则计算',
}

export function taskLabel(task: ModelingTask): string {
  return TASK_LABELS[task]
}

export function servingAction(task: unknown): ModelingServingAction {
  if (task === 'anomaly_detection') return 'detect'
  if (task === 'rule_calculation') return 'calculate'
  if (task === 'regression' || task === 'classification') return 'predict'
  throw new Error('模型签名未声明可识别的任务类型，无法试算')
}
