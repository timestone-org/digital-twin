/** @fileoverview 实时卡片订阅上限的环境变量校验，构建与页面共用。 */
export function parseLiveCardLimit(raw: unknown): number {
  if (raw === undefined) return 20
  if (
    typeof raw !== 'string' ||
    !/^[1-9]\d*$/.test(raw) ||
    !Number.isSafeInteger(Number(raw))
  ) {
    throw new Error('VITE_KNOWLEDGE_CHAT_MAX_ACTIVE_LIVE_CARDS 必须是正整数')
  }
  return Number(raw)
}
