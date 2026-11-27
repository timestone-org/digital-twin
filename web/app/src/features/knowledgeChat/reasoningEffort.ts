/** @fileoverview 知识库单次提问可选的思考强度。 */
import type { KnowledgeReasoningEffort } from '@dt/contracts'

export type EffortSelection = KnowledgeReasoningEffort | 'default'
export const effortOptions = [
  { value: 'default', label: '思考强度 · 模型默认' },
  { value: 'low', label: '本次思考 · 低' },
  { value: 'medium', label: '本次思考 · 中' },
  { value: 'high', label: '本次思考 · 高' },
] as const
