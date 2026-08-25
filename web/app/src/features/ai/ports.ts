/**
 * @fileoverview 应用壳注入给 AI 子系统的口子。
 *
 * ⚠ 全字段可选，**不注入 = 该能力如实缺席**，不是假装成功——与大屏子系统的
 * `DashboardRuntimePorts` 同一口径。三层「关掉」各管各的场景：
 *
 *   编译期  `main.ts` 不调 `installAiAssistant` → 整个子系统不进包
 *   部署期  ai-assistant 没部署 → 探测拿不到 → 入口不出现
 *   账号期  没有 `assistant:use` 权限码 → 入口不出现
 *
 * ⚠ 不用环境变量：本仓明令「环境差异只能是取值不能是行为」，而 ports 缺省
 * 本来就是这个仓表达可选能力的方式。
 */
import type { AssistantCapability } from '@dt/contracts'

import type { AdvanceBody } from '@/api/assistant'

/** 推进一个回合，逐块交出事件流。 */
export type AdvanceStream = (
  sessionId: string,
  body: AdvanceBody,
  signal?: AbortSignal,
) => AsyncGenerator<string>

export interface AiAssistantPorts {
  /**
   * 探一次助手能力。
   * ⚠ 不注入时助手入口**不出现**——而不是出现一个点了报错的按钮。
   */
  probe?: () => Promise<AssistantCapability | null>
  /**
   * 与助手对话。
   * ⚠ 不注入时助手退化成「只能看历史」：能列会话、能读消息，但发不出新回合。
   * 这是刻意的一档，不是没做完——只读那一档在排查现场问题时很有用。
   */
  advance?: AdvanceStream
}

let installed: AiAssistantPorts | null = null

/** 装上口子。重复调用以最后一次为准。 */
export function setAiPorts(ports: AiAssistantPorts): void {
  installed = ports
}

/** 取已装的口子；没装过给 null。 */
export function aiPorts(): AiAssistantPorts | null {
  return installed
}

/**
 * 这套部署到底有没有助手。
 * ⚠ 只回答「代码里装没装」，不回答「服务此刻通不通」——后者要探测，
 * 而探测是一次网络往返，不该在每次渲染时问。
 */
export function isAiInstalled(): boolean {
  return installed !== null
}

/** 只给测试用：回到没装过的状态。 */
export function __resetAiPorts(): void {
  installed = null
}
