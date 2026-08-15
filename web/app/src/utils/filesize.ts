/**
 * @fileoverview 字节数的人读形式。
 *
 * ⚠ 用 1024 进制：服务端 `apps/assets/kinds.py` 的大小闸就是按 MiB 写的，
 * 这里若按 1000 进制换算，「单个文件最大 256 MB」的提示与真正被 policy 拒掉的
 * 那条线对不上，而两边的数字看着都很正常。
 */

const UNITS = ['B', 'KB', 'MB', 'GB'] as const
const STEP = 1024
/** 小于它才留一位小数：1023 KB 写成 1023 KB，1.2 MB 写成 1.2 MB。 */
const FRACTION_BELOW = 10

/**
 * 把字节数写成人读的大小。
 * @param bytes 字节数
 */
export function formatSize(bytes: number): string {
  let value = Math.max(0, bytes)
  let unit = 0
  while (value >= STEP && unit < UNITS.length - 1) {
    value /= STEP
    unit += 1
  }
  // ⚠ 整数不补 `.0`：「1.0 MB」读起来像是量出来的精度，而它只是 1 MB
  const shown =
    value < FRACTION_BELOW && unit > 0
      ? Math.round(value * 10) / 10
      : Math.round(value)
  return `${shown} ${UNITS[unit]}`
}
