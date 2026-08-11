/**
 * @fileoverview 空调台账与空间配置的类型。
 * ⚠ 与 `server/services/platform-server/openapi.json` 手工对齐，一致性由
 * `app/tests/contract/hvac-shapes.contract.spec.ts` 逐字段锁死；改接口先改这里。
 *
 * 层级是固定两级：车间 → 房间 → 空调。**同一房间内的空调互相影响**，房间因此
 * 是分组单位而不只是一个标签。
 */

/** 车间的引用形态：只给指认它所需的最少字段。 */
export interface WorkshopRef {
  id: string
  name: string
}

/** 房间的引用形态。 */
export interface RoomRef {
  id: string
  name: string
}

export interface Workshop {
  id: string
  name: string
  room_count: number
  ac_unit_count: number
  created_at: string
  updated_at: string
}

export interface Room {
  id: string
  name: string
  workshop: WorkshopRef
  /** 这个热力空间里的空调台数。 */
  ac_unit_count: number
  created_at: string
  updated_at: string
}

export interface AcUnit {
  id: string
  /** 全场唯一的设备编号（铭牌号 / 资产号），不是排序号。 */
  serial: string
  name: string
  room: RoomRef
  workshop: WorkshopRef
  created_at: string
  updated_at: string
}

/** 批量改派的结果。`moved_count` 只数真的换了房间的那些。 */
export interface AcUnitRelocateResult {
  moved_count: number
  room: RoomRef
  workshop: WorkshopRef
}

// ⚠ 用 type 而不是 interface：interface 没有隐式索引签名，
// 传给 `request` 的 `query`（Record<...>）会被类型检查拒掉。
export type AcUnitFilters = {
  q?: string | undefined
  room_id?: string | undefined
  workshop_id?: string | undefined
}

/** 一次批量改派的上限，与后端 `MAX_RELOCATE_BATCH` 同值。 */
export const AC_UNIT_RELOCATE_MAX = 200
