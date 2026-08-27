/**
 * @fileoverview 几何的文本面：折线点串与路径 d 的互转，以及写进输入框的数怎么取整。
 *
 * ⚠ 收成一份不是为了少写几行：几何控件手打的那一份与画布取点产出的那一份必须逐字
 * 同源，两处各写一台格式化器的表现是「取点画的折线与手打的差在末位小数上」——图上
 * 看不出来，存盘之后两条本该重合的线错开半个像素。
 */

/** 一串点：`[x, y]` 的序列，量纲跟着图元的坐标口径走。 */
export type Twin2dPointSeq = readonly (readonly [number, number])[]

/** 点与点、x 与 y 之间的分隔：空白与逗号都收。 */
const POINT_SEP = /[\s,]+/

/** 写进框里的点保留几位小数。 */
const POINT_DIGITS = 3

/**
 * 写进框里的数：抹掉浮点噪声。
 * ⚠ 不抹的话 `0.1 + 0.2` 那一类会把框撑成 `0.30000000000000004`，用户以为自己
 * 输错了，删掉重打得到的还是同一串。
 * @param value 原始数
 */
export function twin2dNumText(value: number): string {
  const scale = 10 ** POINT_DIGITS
  return String(Math.round(value * scale) / scale)
}

/**
 * 点串 → 一行文本，形如 `0,0 12,0 12,12`。
 * @param points 点序列
 */
export function twin2dPointsText(points: Twin2dPointSeq): string {
  return points
    .map(([x, y]) => `${twin2dNumText(x)},${twin2dNumText(y)}`)
    .join(' ')
}

/**
 * 一行文本 → 点串；认不出的数与配不成对的末位一律丢弃，与 `normalizeShape` 的
 * 折线一档同一口径。
 * @param raw 框里的原文
 */
export function twin2dParsePoints(raw: string): (readonly [number, number])[] {
  const flat: number[] = []
  for (const piece of raw.trim().split(POINT_SEP)) {
    const value = Number(piece)
    if (piece === '' || !Number.isFinite(value)) continue
    flat.push(value)
  }
  const points: (readonly [number, number])[] = []
  for (let at = 0; at + 1 < flat.length; at += 2) {
    const x = flat[at]
    const y = flat[at + 1]
    if (x === undefined || y === undefined) continue
    points.push([x, y])
  }
  return points
}

/**
 * 点串 → 路径 d：首点提笔，其余连线。
 * ⚠ 只出 `M`/`L` 两个指令：取点取出来的是折点，凭空拟合成曲线会让用户点的位置与
 * 画出来的线对不上。
 * @param points 点序列
 */
export function twin2dPointsPath(points: Twin2dPointSeq): string {
  return points
    .map(
      ([x, y], order) =>
        `${order === 0 ? 'M' : 'L'} ${twin2dNumText(x)} ${twin2dNumText(y)}`,
    )
    .join(' ')
}
