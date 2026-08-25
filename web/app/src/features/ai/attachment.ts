/**
 * @fileoverview 把用户挑的文件读成 base64，交给服务端解析。
 *
 * ⚠ 解析放服务端而不是前端：前端当初拒绝引 xlsx 解析库的理由是「几百 KB 的
 * 包体」（见 pointCsv.ts 的文件头），而那条理由在服务端不成立。
 *
 * ⚠ 分块转码，不能一口气 `String.fromCharCode(...bytes)`：几十万个参数会把
 * 调用栈撑爆，而报出来的是一句与文件毫无关系的 RangeError。
 */

/** 一次转码多少字节。取值只影响栈深，不影响结果。 */
const CHUNK = 8192

/**
 * 把文件读成 base64。
 * @param file 用户挑的那个文件
 */
export async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const parts: string[] = []
  for (let start = 0; start < bytes.length; start += CHUNK) {
    parts.push(
      String.fromCharCode(...bytes.subarray(start, start + CHUNK)),
    )
  }
  return btoa(parts.join(''))
}
