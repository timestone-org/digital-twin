/** @fileoverview 将部署能力与默认模型写入助手面板状态。 */
import type { Ref } from 'vue'
import type { AssistantModelProfile } from '@dt/contracts'
import {
  fillDefaults,
  keepInRange,
  type ModelChoice,
} from '@/composables/useAiModelChoice'
import { aiPorts } from './ports'

/** 将可用能力与缺省选择写入面板。
 * @param into 面板持有的能力状态
 */
export async function probeAiCapability(into: {
  isAvailable: Ref<boolean>
  models: Ref<AssistantModelProfile[]>
  attachmentSuffixes: Ref<string[]>
  choice: Ref<ModelChoice>
}): Promise<void> {
  const ask = aiPorts()?.probe
  if (ask === undefined) return
  const capability = await ask()
  into.isAvailable.value = capability?.is_model_enabled === true
  into.models.value = capability?.models ?? []
  into.attachmentSuffixes.value = capability?.attachment_suffixes ?? []
  fillDefaults(into.choice, capability)
  keepInRange(into.choice, capability)
}
