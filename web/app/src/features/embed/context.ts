/**
 * @fileoverview 嵌入页面的文档级状态：外壳形态、主题覆盖与不可用原因。
 * 凭据留在 auth store 的闭包里；这里不保存 API Key，也不接触任何持久化存储。
 */

import { readonly, ref, type DeepReadonly, type Ref } from 'vue'
import { DEFAULT_THEME_ID, listThemes } from '@dt/tokens'

export const EMBED_MARKER_QUERY = 'embed'
export const EMBED_TOKEN_QUERY = 'token'
export const EMBED_THEME_QUERY = 'theme'
export const EMBED_MARKER_VALUE = '1'

export const EMBED_RELOAD_ERROR =
  '嵌入凭据只在当前页面内有效，请由宿主页面重新加载此内容'

const THEME_IDS = new Set(listThemes().map((theme) => theme.id))

interface EmbedContext {
  isEmbedded: DeepReadonly<Ref<boolean>>
  themeId: DeepReadonly<Ref<string | null>>
  error: DeepReadonly<Ref<string | null>>
}

function initialQuery(): URLSearchParams | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search)
}

const query = initialQuery()
const startsWithToken = query?.has(EMBED_TOKEN_QUERY) ?? false
const startsWithMarker = query?.get(EMBED_MARKER_QUERY) === EMBED_MARKER_VALUE
const startsEmbedded = startsWithToken || startsWithMarker

const isEmbedded = ref(startsEmbedded)
const themeId = ref<string | null>(
  startsEmbedded ? normalizeEmbedTheme(query?.get(EMBED_THEME_QUERY)) : null,
)
const error = ref<string | null>(
  startsWithMarker && !startsWithToken ? EMBED_RELOAD_ERROR : null,
)

const context: EmbedContext = {
  isEmbedded: readonly(isEmbedded),
  themeId: readonly(themeId),
  error: readonly(error),
}

/** 未给或认不出的嵌入主题回落内置默认，不读取用户的本地偏好。 */
export function normalizeEmbedTheme(raw: unknown): string {
  return typeof raw === 'string' && THEME_IDS.has(raw) ? raw : DEFAULT_THEME_ID
}

/** 在创建 auth store 前标记嵌入首航，防止它读取同源普通登录态。 */
export function activateEmbed(theme: unknown): void {
  isEmbedded.value = true
  themeId.value = normalizeEmbedTheme(theme)
  error.value = null
}

/** 用一条明确原因接管页面；全局宿主会替换路由内容。 */
export function showEmbedError(message: string): void {
  isEmbedded.value = true
  error.value = message
}

/** 清掉错误但保留嵌入形态与主题，重新交换凭据时使用。 */
export function clearEmbedError(): void {
  error.value = null
}

/** 恢复普通页面形态。主要供隔离测试与同文档退出嵌入时使用。 */
export function resetEmbedContext(): void {
  isEmbedded.value = false
  themeId.value = null
  error.value = null
}

export function useEmbedContext(): EmbedContext {
  return context
}
