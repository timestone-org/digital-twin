/** @fileoverview 让实时通道跟着登录态走，见 ADR-0014、0049。 */
import { watch } from 'vue'

import { closeRealtimeChannel } from '@/composables/useRealtimeChannel'
import { hasPublicTicket } from '@/runtime/realtimeCredential'
import { useAuthStore } from '@/stores/auth'

/**
 * 登录态清空时关掉通道，应用根调用一次。
 * ⚠ 连接的主体在握手时定死，hub 拒绝换主体，不关的话下一个账号会沿用这条连接。
 */
export function useRealtimeSessionBinding(): void {
  const auth = useAuthStore()
  watch(
    () => auth.accessToken,
    (token) => {
      if (token === null && !hasPublicTicket()) closeRealtimeChannel()
    },
  )
}
