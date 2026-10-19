/** @fileoverview 标准图内部几何与走线形状。 */
import type { GraphNode } from './types'
export type Point = [number, number]
export type Group = {
  sources: string[]
  targets: string[]
}
export type Segment = {
  group: number
  start: Point
  end: Point
  arrow: boolean
}
export interface Metrics {
  labelWidth: number
  labelHeight: number
  lines: string[]
}
export interface Position extends Metrics {
  x: number
  y: number
  rank: number
  row: number
  labelTop: number
  bottom: number
}
export interface Row {
  rank: number
  nodes: GraphNode[]
  wrap: number
}
export const MARGIN = 48,
  GAP = 24,
  TRACK = 12
