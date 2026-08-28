/**
 * @fileoverview 契约：从调色板拖下来那一手的落点——盒摆到指针正中、吸网格、整只盒
 * 夹进画布，三道都做，关掉吸附时只剩另外两道。
 *
 * ⚠ 不摆正不会报错，只是节点整体落在光标右下方，符号越大偏得越远。
 * ⚠ 不吸网格同样不报错，只是拖出来的节点与键盘挪出来的节点从此对不齐。
 * ⚠ 不夹进画布也不报错：节点落在画布外，大屏上整个看不见——用户看到的是
 * 「拖下去什么都没出现」，与「拖放坏了」分不开。
 */
import { normalizeCanvas } from '@dt/twin2d'
import type { Twin2dNodeSize } from '@dt/twin2d'
import { describe, expect, it } from 'vitest'

import { twin2dDropPoint } from '@/pages/Twin2dEditor/scripts/paletteDrag'
import { TWIN_2D_DEFAULT_SNAP } from '@/pages/Twin2dEditor/scripts/snapping'

/** 画布 400×200：非方形，两轴写反了才看得出来。 */
const CANVAS = normalizeCanvas({
  width: 400,
  height: 200,
  grid: 20,
  showGrid: true,
})

/** 边长不是整格数的那一份：先吸还是先夹在这里才分得开。 */
const ODD_CANVAS = normalizeCanvas({
  width: 410,
  height: 210,
  grid: 20,
  showGrid: true,
})

/** 非方形的符号：宽高各按各的一半让位，写反了才看得出来。 */
const SIZE: Twin2dNodeSize = { w: 40, h: 20 }

/** 比整张画布还大的那一份：让位之后没有一格是放得下的。 */
const HUGE: Twin2dNodeSize = { w: 900, h: 900 }

/** 这一帧的吸附：按画布自己的栅格走，与画布层同一份口径。 */
const SNAP = { ...TWIN_2D_DEFAULT_SNAP, grid: CANVAS.grid }

/** 自由摆放那一档。 */
const FREE = { ...SNAP, enabled: false }

describe('落点', () => {
  it('盒摆到指针正中，再吸到最近的一格上', () => {
    // 正中让位后是 (227, 123)，吸到 (220, 120)
    expect(twin2dDropPoint({ x: 247, y: 133 }, SIZE, CANVAS, SNAP)).toEqual({
      x: 220,
      y: 120,
    })
  })

  it('关掉吸附也照样摆正中，只是不再吸格', () => {
    expect(twin2dDropPoint({ x: 247, y: 133 }, SIZE, CANVAS, FREE)).toEqual({
      x: 227,
      y: 123,
    })
  })

  it('画布左上角外的那一手夹回原点', () => {
    expect(twin2dDropPoint({ x: -300, y: -40 }, SIZE, CANVAS, SNAP)).toEqual({
      x: 0,
      y: 0,
    })
  })

  it('画布右下角外的那一手夹到整只盒都在画布里，两轴各夹各的', () => {
    expect(twin2dDropPoint({ x: 9000, y: 9000 }, SIZE, CANVAS, SNAP)).toEqual({
      x: CANVAS.width - SIZE.w,
      y: CANVAS.height - SIZE.h,
    })
  })

  it('先吸后夹：边长不是整格数时也落在画布里', () => {
    // 反过来的话，夹到 370 的那一步之后还会被吸到 380，右边就伸出画布了
    expect(
      twin2dDropPoint({ x: 9000, y: 9000 }, SIZE, ODD_CANVAS, SNAP),
    ).toEqual({ x: ODD_CANVAS.width - SIZE.w, y: ODD_CANVAS.height - SIZE.h })
  })

  it('比画布还大的符号落在原点，不落到负坐标上', () => {
    expect(twin2dDropPoint({ x: 200, y: 100 }, HUGE, CANVAS, SNAP)).toEqual({
      x: 0,
      y: 0,
    })
  })
})
