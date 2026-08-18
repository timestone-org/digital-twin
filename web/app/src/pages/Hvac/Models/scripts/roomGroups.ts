/**
 * @fileoverview 左栏房间列表的纯逻辑：收哪些房间、怎么分组排序、选中兜底。
 *
 * ⚠ 排序按物理归属（车间 · 房间名）而不是模型数：数量会随建模与删除变化，
 * 按它排会让行跟着跳，用户刚记住的位置就没了。
 */
import type { AcModel, Room } from '@dt/contracts'

import { isModelBusy } from '@/features/hvac/modelView'

/** 房间多于这个数才渲染筛选框——三五个房间给个搜索框只是噪声。 */
export const ROOM_FILTER_MIN = 8

export interface RoomEntry {
  id: string
  name: string
  workshopId: string
  workshopName: string
  acUnitCount: number
  modelCount: number
  /** 这个房间有模型正在排队或训练，栏里给一枚圆点。 */
  isTraining: boolean
}

export interface WorkshopGroup {
  id: string
  name: string
  rooms: RoomEntry[]
}

export interface RoomListing {
  entries: RoomEntry[]
  /** 因为没有空调、也没有历史模型而被挡掉的房间数。 */
  hiddenCount: number
}

/**
 * 收进左栏的房间，按车间名 → 房间名升序。
 * ⚠ 「有空调」与「有历史模型」是**或**关系：机组被挪走之后房间的
 * `ac_unit_count` 会掉到 0，但它历史上训出来的模型还在，藏掉房间等于让
 * 那些模型从界面上消失且无法删除。
 * @param rooms 全量房间
 * @param models 全量模型，用来数每个房间的模型
 */
export function buildRoomListing(
  rooms: readonly Room[],
  models: readonly AcModel[],
): RoomListing {
  const counts = new Map<string, number>()
  const training = new Set<string>()
  for (const model of models) {
    counts.set(model.room.id, (counts.get(model.room.id) ?? 0) + 1)
    if (isModelBusy(model)) training.add(model.room.id)
  }
  const entries = rooms
    .filter((room) => room.ac_unit_count > 0 || (counts.get(room.id) ?? 0) > 0)
    .map((room) => ({
      id: room.id,
      name: room.name,
      workshopId: room.workshop.id,
      workshopName: room.workshop.name,
      acUnitCount: room.ac_unit_count,
      modelCount: counts.get(room.id) ?? 0,
      isTraining: training.has(room.id),
    }))
    .sort(byWorkshopThenName)
  return { entries, hiddenCount: rooms.length - entries.length }
}

function byWorkshopThenName(left: RoomEntry, right: RoomEntry): number {
  const workshop = left.workshopName.localeCompare(right.workshopName, 'zh-CN')
  return workshop === 0
    ? left.name.localeCompare(right.name, 'zh-CN')
    : workshop
}

/**
 * 按车间分组，组序即入参序（已排好）。
 * @param entries 已过滤排序的房间
 */
export function groupByWorkshop(
  entries: readonly RoomEntry[],
): WorkshopGroup[] {
  const groups: WorkshopGroup[] = []
  for (const entry of entries) {
    const last = groups.at(-1)
    if (last !== undefined && last.id === entry.workshopId) {
      last.rooms.push(entry)
      continue
    }
    groups.push({
      id: entry.workshopId,
      name: entry.workshopName,
      rooms: [entry],
    })
  }
  return groups
}

/**
 * 关键词过滤：匹配房间名或车间名的大小写无关子串。
 * @param entries 已过滤排序的房间
 * @param keyword 用户输入，空串即不过滤
 */
export function filterRooms(
  entries: readonly RoomEntry[],
  keyword: string,
): RoomEntry[] {
  const needle = keyword.trim().toLowerCase()
  if (needle === '') return [...entries]
  return entries.filter(
    (entry) =>
      entry.name.toLowerCase().includes(needle) ||
      entry.workshopName.toLowerCase().includes(needle),
  )
}

/**
 * 选中哪个房间：给定的那个（存在才算）→ 第一个有模型的 → 第一个 → 空。
 * ⚠ 校验必须等房间列表到手再做，不然会把用户带着 `?room=` 打开的链接洗掉。
 * @param entries 已过滤排序的房间
 * @param wanted 地址栏里带来的房间 id，空串表示没给
 */
export function resolveRoomId(
  entries: readonly RoomEntry[],
  wanted: string,
): string {
  if (entries.some((entry) => entry.id === wanted)) return wanted
  const withModels = entries.find((entry) => entry.modelCount > 0)
  return withModels?.id ?? entries[0]?.id ?? ''
}
