/**
 * @fileoverview 哪几路要先登录一次，以及各自在界面上叫什么。
 *
 * ⚠ 按后端下发的**形态**判，不按名字猜：形态说了要登录的那几路才摆登录面板，
 * 而形态清单与后端校验同源。
 *
 * ⚠ 登录态挂在**那一行供应商**上（ADR-0041）：目录之外配出来的那一路无处存
 * 登录态，故这一页只摆目录里的那几路——摆一个存不了登录态的面板，点下去是一条
 * 指不回任何地方的错。
 */
import type { LlmProvider, LlmProviderKind } from '@dt/contracts'

/** 一路要登录的账号在界面上的样子。 */
export interface SubscriptionAccount {
  /** 登录接口认的那个键：目录里那一路供应商的 id */
  ref: string
  name: string
}

/**
 * 这一页要摆几个登录面板。
 * @param providers 目录里的那几路
 * @param kinds 后端下发的形态清单
 */
export function subscriptionAccounts(
  providers: readonly LlmProvider[],
  kinds: readonly LlmProviderKind[],
): SubscriptionAccount[] {
  const loginKinds = new Set(
    kinds.filter((one) => one.is_login_required).map((one) => one.code),
  )
  return providers
    .filter((one) => loginKinds.has(one.kind))
    .map((one) => ({ ref: one.id, name: one.name }))
}
