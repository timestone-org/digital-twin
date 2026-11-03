/** @fileoverview 按 AI 功能开关幂等装配助手交互端口。 */
import { advanceTurn, probeCapability, saveToolReceipts } from '@/api/assistant'
import { AI_ENABLED } from '@/config/app'
import { setAiPorts } from '@/features/ai/ports'

let installed = false

/** 把助手的口子装上；重复调用只做第一次。 */
export function installAiAssistant(): void {
  if (!AI_ENABLED || installed) return
  installed = true
  setAiPorts({
    probe: probeCapability,
    advance: advanceTurn,
    saveReceipts: saveToolReceipts,
  })
}

/** 只给测试用：让「只装一次」这条判定回到初始状态。 */
export function __resetAiBootstrap(): void {
  installed = false
}
