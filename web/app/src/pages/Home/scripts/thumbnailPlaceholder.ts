/**
 * @fileoverview 缩略图占位图的几何：按大屏 id 确定性生成一组模块方块。
 *
 * ⚠ 不用随机数：随机占位会让同一张卡片每次挂载都换个样子，看上去像是这张屏
 * 的内容在变，而它其实只是还没截过图。
 */

/** 占位块数量的下限与浮动区间。 */
const MIN_BLOCKS = 3
const BLOCK_SPREAD = 4

/** 一块占位方块，取值都是百分比，直接喂给内联 style。 */
export interface PlaceholderBlock {
  key: string
  leftPercent: number
  topPercent: number
  widthPercent: number
  heightPercent: number
}

/**
 * 字符串 → 32 位无符号散列（FNV-1a）。
 * @param text 待散列的文本
 */
export function hashString(text: string): number {
  let hash = 2_166_136_261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

/**
 * mulberry32：同一个种子永远吐同一串 [0, 1) 的数。
 * @param seed 种子
 */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }
}

/**
 * 一张屏的占位方块。同一个 id 每次调用结果完全相同。
 * @param dashboardId 大屏 id
 */
export function placeholderBlocks(dashboardId: string): PlaceholderBlock[] {
  const random = createRandom(hashString(dashboardId))
  const count = MIN_BLOCKS + Math.floor(random() * BLOCK_SPREAD)
  const blocks: PlaceholderBlock[] = []
  for (let index = 0; index < count; index += 1) {
    // 各档的上界之和恰好 100：越界的部分会被容器裁成一道齐平的切边
    blocks.push({
      key: `${dashboardId}-${index}`,
      leftPercent: 6 + random() * 56,
      topPercent: 8 + random() * 60,
      widthPercent: 18 + random() * 20,
      heightPercent: 12 + random() * 20,
    })
  }
  return blocks
}
