/** @fileoverview 标准图正交连接与跨层侧通道。 */
import { orderHeaders } from './diagramHeaders'
import type { Placement } from './diagramPlacement'
import type { Group, Point, Position, Segment } from './diagramTypes'
import { MARGIN, TRACK } from './diagramTypes'
import { required } from './required'

function railPosition(state: Placement, index: number): number {
  return (
    state.document.paper.width -
    MARGIN -
    state.gutter +
    24 +
    (state.plan.count - 1 - required(state.plan.lanes.get(index))) * TRACK
  )
}
function orderChannels(state: Placement) {
  state.incoming.forEach((ids, row) => {
    state.incoming[row] = orderHeaders(ids, row, state.groups, {
      positions: state.positions,
      lanes: state.plan.lanes,
      railX: (index) => railPosition(state, index),
    })
  })
  const left = (index: number) =>
    Math.min(
      ...required(state.groups[index]).sources.map(
        (id) => required(state.positions.get(id)).x,
      ),
    )
  state.outgoing.forEach((ids) =>
    ids.sort((first, second) => left(second) - left(first)),
  )
}
interface Network {
  index: number
  sources: Position[]
  group: Group
  lane: number | undefined
  railX: number
  joins: number[]
}
class Connections {
  readonly segments: Segment[] = []
  constructor(readonly state: Placement) {}
  add(group: number, start: Point, end: Point, arrow = false) {
    if (start[0] !== end[0] || start[1] !== end[1])
      this.segments.push({ group, start, end, arrow })
  }
  sources(network: Network) {
    if (network.lane === undefined) return
    for (const position of network.sources) {
      const y =
        required(this.state.bottoms[position.row]) +
        16 +
        required(this.state.outgoing[position.row]).indexOf(network.index) *
          TRACK
      this.add(network.index, [position.x, position.bottom], [position.x, y])
      this.add(network.index, [position.x, y], [network.railX, y])
      network.joins.push(y)
    }
  }
  targets(network: Network, row: number) {
    const children = network.group.targets
      .map((id) => required(this.state.positions.get(id)))
      .filter((position) => position.row === row)
    const incoming = required(this.state.incoming[row])
    const y =
      required(this.state.centers[row]) -
      85 -
      (incoming.length - 1 - incoming.indexOf(network.index)) * TRACK
    const xs = children.map((position) => position.x)
    if (network.lane === undefined) {
      for (const position of network.sources) {
        xs.push(position.x)
        this.add(network.index, [position.x, position.bottom], [position.x, y])
      }
    } else {
      xs.push(network.railX)
      network.joins.push(y)
    }
    this.add(network.index, [Math.min(...xs), y], [Math.max(...xs), y])
    for (const position of children)
      this.add(
        network.index,
        [position.x, y],
        [position.x, position.y - 45],
        true,
      )
  }
  group(group: Group, index: number) {
    const sources = group.sources.map((id) =>
      required(this.state.positions.get(id)),
    )
    const targetRows = [
      ...new Set(
        group.targets.map((id) => required(this.state.positions.get(id)).row),
      ),
    ].sort((first, second) => first - second)
    const lane = this.state.plan.lanes.get(index)
    const network: Network = {
      group,
      index,
      sources,
      lane,
      railX: lane === undefined ? 0 : railPosition(this.state, index),
      joins: [],
    }
    this.sources(network)
    for (const row of targetRows) this.targets(network, row)
    if (lane !== undefined)
      this.add(
        index,
        [network.railX, Math.min(...network.joins)],
        [network.railX, Math.max(...network.joins)],
      )
  }
}
export function connectRows(state: Placement): Segment[] {
  orderChannels(state)
  const connections = new Connections(state)
  state.groups.forEach((group, index) => connections.group(group, index))
  return connections.segments
}
