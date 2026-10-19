// @vitest-environment node
/** @fileoverview 案例标准排版、图约束与 SVG 安全契约。 */
import { it } from 'vitest'
import assert from 'node:assert/strict'
import { SAMPLE } from '../../../../src/pages/Tools/Hierarchy/scripts/sample'
import {
  ranks,
  validate,
} from '../../../../src/pages/Tools/Hierarchy/scripts/graph'
import { generate } from '../../../../src/pages/Tools/Hierarchy/scripts/drawing'
const sample = () => structuredClone(SAMPLE)
import { arrange } from '../../../../src/pages/Tools/Hierarchy/scripts/arrange'
import {
  alignNodes,
  editorSize,
  snapGuides,
} from '../../../../src/pages/Tools/Hierarchy/scripts/geometry'
import type { GraphDocument } from '../../../../src/pages/Tools/Hierarchy/scripts/types'
function fan(count: number): GraphDocument {
  const doc = sample()
  doc.nodes = []
  doc.edges = []
  for (let i = 0; i <= count; i++) {
    doc.nodes.push({
      id: `n${i}`,
      code: `N${i}`,
      kind: 'meter',
      name: '测试节点',
      parameter: '1.0级',
      order: i,
      position: { x: 0, y: 0 },
    })
    if (i) doc.edges.push({ id: `e${i}`, source: 'n0', target: `n${i}` })
  }
  return doc
}
it('old JSON defaults to case width; invalid widths do not silently resize', () => {
  const doc = sample(),
    old = { ...doc } as Partial<GraphDocument>
  delete old.paper
  assert.equal(validate(old).paper.width, 1516)
  for (const width of [0, 359, 12001, Infinity, '1516'])
    assert.throws(() => validate({ ...doc, paper: { width } }), /宽度/)
})
it('same-level wrapping is based on available width, including the exact fit boundary', () => {
  const doc = fan(12)
  doc.paper.width = 1560 // 2 * 48 margin + 12 * 100 + 11 * 24 spacing.
  assert.deepEqual(
    generate(doc).rows.map((r) => r.count),
    [1, 12],
  )
  doc.paper.width = 1559
  assert.deepEqual(
    generate(doc).rows.map((r) => r.count),
    [1, 11, 1],
  )
  doc.paper.width = 3200
  const wider = generate(doc)
  assert.equal(wider.width, 3200)
  assert.deepEqual(
    wider.rows.map((r) => r.count),
    [1, 12],
  )
})
function crossings(svg: string) {
  const paths = [
    ...svg.matchAll(
      /<path data-net="(\d+)" d="M([\d.]+) ([\d.]+) L([\d.]+) ([\d.]+)"/g,
    ),
  ].map((match): [number, number, number, number, number] => [
    Number(required(match[1])),
    Number(required(match[2])),
    Number(required(match[3])),
    Number(required(match[4])),
    Number(required(match[5])),
  ])
  let count = 0
  for (const [net, x1, y1, x2, y2] of paths) {
    if (x1 !== x2) continue
    for (const [other, a, b, c, d] of paths) {
      if (net === other || b !== d) continue
      if (
        Math.min(a, c) < x1 &&
        x1 < Math.max(a, c) &&
        Math.min(y1, y2) < b &&
        b < Math.max(y1, y2)
      )
        count++
    }
  }
  return count
}
it('all circle diameters and same-level name frame sizes are equal, including continuation rows', () => {
  for (const width of [700, 1516, 3200]) {
    const doc = sample()
    doc.paper.width = width
    const drawing = generate(doc),
      sizes = new Map<number, string>()
    for (const node of doc.nodes.filter((n) => n.kind === 'meter')) {
      const match = required(
        drawing.svg.match(
          new RegExp(`<g data-node-id="${node.id}">([\\s\\S]*?)</g>`),
        ),
      )
      const shape = required(match[1])
      assert.match(shape, /<circle[^>]+r="45"/)
      const box = required(
        shape.match(/<rect[^>]+width="([\d.]+)" height="([\d.]+)"/),
      )
      const rank = required(drawing.positions[node.id]).rank,
        size = `${box[1]}x${box[2]}`
      if (sizes.has(rank)) assert.equal(size, sizes.get(rank))
      else sizes.set(rank, size)
    }
  }
})
it('branch centering and bus ordering eliminate unrelated line crossings in the default reference diagram', () => {
  const doc = sample()
  assert.equal(crossings(generate(doc).svg), 0)
  doc.paper.width = 3200
  assert.equal(crossings(generate(doc).svg), 0)
  doc.paper.width = 700
  assert.ok(crossings(generate(doc).svg) <= 7)
})
it('children follow parent branches even when their numeric order interleaves the branches', () => {
  const doc = fan(4)
  doc.edges = [
    { id: 'a', source: 'n0', target: 'n2' },
    { id: 'b', source: 'n0', target: 'n4' },
    { id: 'c', source: 'n1', target: 'n3' },
  ]
  const drawing = generate(doc)
  assert.ok(required(drawing.positions.n2).x < required(drawing.positions.n4).x)
  assert.ok(required(drawing.positions.n4).x < required(drawing.positions.n3).x)
  assert.equal(crossings(drawing.svg), 0)
})
it('wrapped root and intermediate levels still connect to all downstream levels and skip-level targets', () => {
  const doc = sample()
  // Four sources, a shared junction, five middle nodes, five children and a wrapped
  // terminal level. Add another level after those terminals, including multiple parents.
  for (let i = 1; i <= 19; i++) {
    doc.nodes.push({
      id: `end${i}`,
      code: `E${i}`,
      kind: 'meter',
      name: '末级节点',
      parameter: '1.0级',
      order: i,
      position: { x: 0, y: 0 },
    })
    doc.edges.push({ id: `end-e${i}`, source: `t${i}`, target: `end${i}` })
  }
  doc.edges.push(
    { id: 'skip', source: 's4', target: 'end19' },
    { id: 'multi', source: 't1', target: 'end19' },
  )
  for (const width of [700, 900, 1516, 3200]) {
    doc.paper.width = width
    const drawing = generate(doc)
    assert.equal(drawing.width, width)
    assert.equal(drawing.nodeCount, 52)
    for (const e of doc.edges) {
      const from = drawing.positions[e.source],
        to = drawing.positions[e.target]
      if (from && to)
        assert.ok(
          from.row < to.row,
          `${width}: ${e.source} must precede ${e.target}`,
        )
    }
    const middle = Object.values(drawing.positions).filter((p) => p.rank === 3)
    const last = Object.values(drawing.positions).filter((p) => p.rank === 4)
    assert.ok(
      Math.max(...middle.map((p) => p.row)) <
        Math.min(...last.map((p) => p.row)),
    )
    assert.ok(
      Object.values(drawing.positions).every(
        (p) => p.x >= 48 && p.x <= width - 48,
      ),
    )
  }
})
it('automatic layout is deterministic, preserves content, aligns logical peers and separates cards', async () => {
  const doc = sample()
  doc.nodes.push({
    id: 'independent',
    code: 'R1',
    kind: 'meter',
    name: '独立节点',
    parameter: '',
    order: 99,
    position: { x: 0, y: 0 },
  })
  doc.edges.push({ id: 'multi', source: 's2', target: 'm2' })
  const first = await arrange(doc),
    second = await arrange(first),
    depth = ranks(doc)
  assert.deepEqual(first, second)
  assert.deepEqual(first.edges, doc.edges)
  assert.deepEqual(first.paper, doc.paper)
  for (const a of first.nodes) {
    assert.deepEqual(
      { ...a, position: undefined },
      { ...doc.nodes.find((n) => n.id === a.id), position: undefined },
    )
    for (const b of first.nodes) {
      if (a.id === b.id) continue
      if (depth.get(a.id) === depth.get(b.id) && a.kind === b.kind)
        assert.equal(a.position.y, b.position.y)
      assert.ok(
        a.position.x + editorSize(a).width <= b.position.x ||
          b.position.x + editorSize(b).width <= a.position.x ||
          a.position.y + editorSize(a).height <= b.position.y ||
          b.position.y + editorSize(b).height <= a.position.y,
      )
    }
  }
  for (const e of first.edges)
    assert.ok(
      required(first.nodes.find((n) => n.id === e.source)).position.y <
        required(first.nodes.find((n) => n.id === e.target)).position.y,
    )
})
it('alignment respects mixed node bounds, distribution and guide snapping use the same geometry', () => {
  const nodes = fan(2).nodes
  required(nodes[1]).kind = 'junction'
  required(nodes[0]).position = { x: 10, y: 30 }
  required(nodes[1]).position = { x: 300, y: 300 }
  required(nodes[2]).position = { x: 900, y: 600 }
  const aligned = alignNodes(nodes, 'bottom')
  assert.deepEqual(
    aligned.map((n, i) => n.position.y + editorSize(required(nodes[i])).height),
    [748, 748, 748],
  )
  assert.deepEqual(
    alignNodes(nodes, 'horizontal').map((n) => n.position.x),
    [10, 455, 900],
  )
  const snap = snapGuides(
    [{ ...required(nodes[0]), position: { x: 297, y: 150 } }],
    [required(nodes[1])],
    6,
  )
  assert.equal(snap.dx, 3)
  assert.ok(snap.guides.some((g) => g.axis === 'x' && g.value === 300))
  assert.equal(
    snapGuides(
      [{ ...required(nodes[0]), position: { x: 280, y: 100 } }],
      [required(nodes[1])],
      6,
    ).guides.length,
    0,
  )
})

import { required } from '../../../../src/pages/Tools/Hierarchy/scripts/required'
