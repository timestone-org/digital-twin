/**
 * @fileoverview 哪几路要先登录一次，以及各自在界面上叫什么。
 *
 * ⚠ 按后端下发的**形态**判，不按名字猜：形态说了要登录的那几路才摆登录面板，
 * 而形态清单与后端校验同源。
 *
 * ⚠ 目录里没有订阅型供应商时，还要认环境变量配出来的那一路——它不在目录里，
 * 只在助手的能力面上露过一次面。不认的话，一套按老办法配好的部署会在这一页上
 * 完全找不到登录入口，而助手那边说着「这一路没登录」。
 */
import type { LlmProvider, LlmProviderKind } from '@dt/contracts'

import { CODEX_PROVIDER } from './useCodexLogin'

/** 一路要登录的账号在界面上的样子。 */
export interface SubscriptionAccount {
  /** 登录接口认的那个键：目录里那一路的 id，或环境变量那一路的 `codex` */
  ref: string
  name: string
  /** 目录里配出来的那一路为真；环境变量那一路为假 */
  isFromCatalog: boolean
}

/**
 * 这一页要摆几个登录面板。
 * @param providers 目录里的那几路
 * @param kinds 后端下发的形态清单
 * @param assistantProfiles 助手能力面报的那几路档位名
 */
export function subscriptionAccounts(
  providers: readonly LlmProvider[],
  kinds: readonly LlmProviderKind[],
  assistantProfiles: readonly string[],
): SubscriptionAccount[] {
  const loginKinds = new Set(
    kinds.filter((one) => one.is_login_required).map((one) => one.code),
  )
  const fromCatalog = providers
    .filter((one) => loginKinds.has(one.kind))
    .map((one) => ({ ref: one.id, name: one.name, isFromCatalog: true }))
  if (fromCatalog.length > 0) return fromCatalog
  if (!assistantProfiles.includes(CODEX_PROVIDER)) return []
  return [
    { ref: CODEX_PROVIDER, name: '订阅账号（环境变量）', isFromCatalog: false },
  ]
}
