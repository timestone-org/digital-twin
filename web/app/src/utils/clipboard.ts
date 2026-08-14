/**
 * @fileoverview 复制一段文本到剪贴板。
 *
 * ⚠ `navigator.clipboard` 只在**安全上下文**（HTTPS 或 localhost）里存在。
 * 本平台按内网 IP 走纯 HTTP 交付，那里它是 undefined——只在现场失效，
 * 开发机永远复现不了。这与 `newIdempotencyKey` 避开 `crypto.randomUUID`
 * 是同一个坑，所以这里也必须自带退路。
 */

/** 老接口的退路：塞一个离屏 textarea，选中，走 execCommand。 */
function copyBySelection(text: string): boolean {
  const holder = document.createElement('textarea')
  holder.value = text
  // 不能用 display:none —— 选不中就复制不了
  holder.setAttribute('aria-hidden', 'true')
  holder.style.position = 'fixed'
  holder.style.opacity = '0'
  document.body.appendChild(holder)
  holder.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(holder)
  }
}

/**
 * 复制文本。返回是否成功——调用方据此给出「已复制」还是「请手动复制」。
 * @param text 要复制的内容
 */
export async function copyText(text: string): Promise<boolean> {
  const api: Clipboard | undefined = navigator.clipboard
  if (api !== undefined) {
    try {
      await api.writeText(text)
      return true
    } catch {
      // 安全上下文之外或用户拒绝授权，落到退路
    }
  }
  return copyBySelection(text)
}
