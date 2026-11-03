/**
 * @fileoverview 应用壳注入给 AI 子系统的可选交互端口。
 * VITE_AI_ENABLED 关闭时不装配；启用后仍受部署能力探测和账号权限约束。
 */
import type { AssistantCapability, AssistantToolResult } from '@dt/contracts'

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
  /** 只保存实际客户端回执，停止回合也能调用。 */
  saveReceipts?: (
    sessionId: string,
    results: readonly AssistantToolResult[],
  ) => Promise<void>
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
