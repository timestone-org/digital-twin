/** @fileoverview Excel ZIP 在解析前的压缩及解压体积保护。 */
import { DomainError } from './graph'
const MAX_FILE = 5_000_000
const MAX_ENTRY = 10_000_000
const MAX_INFLATED = 40_000_000

function invalid(): never {
  throw new DomainError(
    'Excel 文件内容过大、加密或损坏，请使用精简的 .xlsx 配置',
  )
}

async function inflatedSize(
  bytes: Uint8Array<ArrayBuffer>,
  method: number,
): Promise<number> {
  if (method === 0) return bytes.length
  if (method !== 8) return invalid()
  const reader = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader()
  let total = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) return total
      total += next.value.length
      if (total > MAX_ENTRY) return invalid()
    }
  } catch {
    return invalid()
  } finally {
    await reader.cancel()
  }
}

function directory(data: DataView): number {
  if (data.byteLength > MAX_FILE || data.byteLength < 22) return invalid()
  for (
    let offset = data.byteLength - 22;
    offset >= Math.max(0, data.byteLength - 65557);
    offset--
  ) {
    if (
      data.getUint32(offset, true) === 0x06054b50 &&
      offset + 22 + data.getUint16(offset + 20, true) === data.byteLength
    )
      return offset
  }
  return invalid()
}

async function checkEntry(
  data: DataView,
  offset: number,
  start: number,
): Promise<{ next: number; length: number }> {
  if (
    offset + 46 > data.byteLength ||
    data.getUint32(offset, true) !== 0x02014b50
  )
    return invalid()
  const flags = data.getUint16(offset + 8, true)
  const compressed = data.getUint32(offset + 20, true)
  const length = data.getUint32(offset + 24, true)
  const local = data.getUint32(offset + 42, true)
  if (flags & 1 || length > MAX_ENTRY || local + 30 + compressed > start)
    return invalid()
  if (data.getUint32(local, true) !== 0x04034b50) return invalid()
  const body =
    local +
    30 +
    data.getUint16(local + 26, true) +
    data.getUint16(local + 28, true)
  if (body + compressed > start) return invalid()
  const bytes = new Uint8Array(compressed)
  bytes.set(new Uint8Array(data.buffer, body, compressed))
  if ((await inflatedSize(bytes, data.getUint16(offset + 10, true))) !== length)
    return invalid()
  const next =
    offset +
    46 +
    data.getUint16(offset + 28, true) +
    data.getUint16(offset + 30, true) +
    data.getUint16(offset + 32, true)
  return { next, length }
}

export async function checkArchive(buffer: ArrayBuffer): Promise<void> {
  const data = new DataView(buffer)
  const end = directory(data)
  const count = data.getUint16(end + 10, true)
  const size = data.getUint32(end + 12, true)
  const start = data.getUint32(end + 16, true)
  if (
    count > 500 ||
    start + size > end ||
    data.getUint16(end + 4, true) ||
    data.getUint16(end + 6, true)
  )
    return invalid()
  let offset = start,
    total = 0
  for (let index = 0; index < count; index++) {
    const entry = await checkEntry(data, offset, start)
    total += entry.length
    if (total > MAX_INFLATED) return invalid()
    offset = entry.next
  }
  if (offset !== start + size) return invalid()
}
