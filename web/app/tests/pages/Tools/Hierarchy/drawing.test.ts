// @vitest-environment node
/** @fileoverview 案例标准排版、图约束与 SVG 安全契约。 */
import type { GraphDocument } from '../../../../src/pages/Tools/Hierarchy/scripts/types'
import { it } from 'vitest'
import assert from 'node:assert/strict'
import { SAMPLE } from '../../../../src/pages/Tools/Hierarchy/scripts/sample'
import {
  DomainError,
  ranks,
  validate,
} from '../../../../src/pages/Tools/Hierarchy/scripts/graph'
import { generate } from '../../../../src/pages/Tools/Hierarchy/scripts/drawing'
const sample = () => structuredClone(SAMPLE)
it('reference has 33 meters, four logical levels and 11 + 8 folded terminals', () => {
  const d = generate(sample())
  assert.strictEqual(d.nodeCount, 33)
  assert.strictEqual(d.levelCount, 4)
  assert.deepEqual(
    d.rows.map((r) => r.count),
    [4, 5, 5, 11, 8],
  )
  assert.deepEqual([d.width, d.height], [1516, 1237])
  assert.strictEqual(
    required(d.positions.t12).rank,
    required(d.positions.t19).rank,
  )
  assert.ok(required(d.positions.t12).x > required(d.positions.t19).x)
  assert.strictEqual((d.svg.match(/<circle /g) || []).length, 33)
})
it('editor positions and viewport never affect standard output', () => {
  const d = sample(),
    before = generate(d).svg
  d.nodes.forEach((n, i) => {
    n.position = { x: i * 123 - 600, y: i * 71 }
  })
  d.viewport = { x: -400, y: 800, zoom: 1.3 }
  assert.strictEqual(generate(d).svg, before)
})
it('edited content is included and markup is escaped', () => {
  const d = sample()
  required(d.nodes[0]).parameter = '0.5级'
  required(d.nodes[0]).name = '<蒸汽>&'
  const result = generate(d)
  assert.ok(result.svg.includes('0.5级'))
  assert.ok(result.svg.includes('&lt;蒸汽&gt;&amp;'))
  assert.ok(!result.svg.includes('<蒸汽>'))
})
it('multiple parents work, but cycles and self connections do not', () => {
  const d = sample()
  d.edges.push({ id: 'extra', source: 's2', target: 'm2' })
  assert.strictEqual(validate(d).edges.length, 34)
  assert.strictEqual(ranks(d).get('m2'), 1)
  assert.strictEqual(generate(d).nodeCount, 33)
  d.edges.push({ id: 'cycle', source: 'm1', target: 's1' })
  assert.throws(
    () => validate(d),
    (e: unknown) => e instanceof DomainError && e.code === 'CYCLE',
  )
  const self = sample()
  self.edges.push({ id: 'self', source: 's1', target: 's1' })
  assert.throws(() => validate(self), /自身/)
})
it('duplicate codes and edges, dangling links and nonfinite coordinates are rejected', () => {
  const d = sample()
  required(d.nodes[1]).code = required(d.nodes[0]).code
  assert.throws(() => validate(d), /重复/)
  const edge = sample()
  edge.edges.push({ ...required(edge.edges[0]), id: 'copy' })
  assert.throws(() => validate(edge), /重复/)
  const missing = sample()
  required(missing.edges[0]).target = 'unknown'
  assert.throws(() => validate(missing), /不存在/)
  const coord = sample()
  required(coord.nodes[0]).position.x = Infinity
  assert.throws(() => validate(coord), /范围/)
})
it('malformed configurations fail with domain errors', () => {
  for (const input of [
    null,
    [],
    'bad',
    {},
    { ...sample(), viewport: null },
    { ...sample(), nodes: [{}] },
  ])
    assert.throws(() => validate(input), DomainError)
})
it('incomplete junctions can be saved but generation identifies the node', () => {
  const d = sample()
  d.edges = d.edges.filter((e) => e.source !== 'bus')
  assert.strictEqual(validate(d).nodes.length, 34)
  assert.throws(
    () => generate(d),
    (e: unknown) =>
      e instanceof DomainError && e.issues.some((i) => i.nodeId === 'bus'),
  )
})
it('long labels are reported instead of clipped', () => {
  const d = sample()
  required(d.nodes[0]).name = '名称过长'.repeat(8)
  assert.throws(
    () => generate(d),
    (e: unknown) => e instanceof DomainError && e.code === 'DRAWING_INVALID',
  )
})
it('reparenting recomputes hierarchy', () => {
  const d = sample()
  d.edges = d.edges.filter((e) => e.target !== 't1')
  d.edges.push({ id: 'reparent', source: 'm2', target: 't1' })
  assert.strictEqual(required(generate(d).positions.t1).rank, 2)
})
it('branched DAGs reserve routing space on every continuation row', () => {
  let seed = 123456
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296
  for (let run = 0; run < 80; run++) {
    const document = sample()
    document.nodes = []
    document.edges = []
    for (let i = 0; i < 12 + (run % 40); i++) {
      document.nodes.push({
        id: `n${i}`,
        kind: 'meter',
        code: `N-${i}`,
        name: '测试节点',
        parameter: '1.0级',
        order: i,
        position: { x: 0, y: 0 },
      })
      addRandomEdges(document, i, random)
    }
    assert.strictEqual(generate(document).nodeCount, document.nodes.length)
  }
})

import { required } from '../../../../src/pages/Tools/Hierarchy/scripts/required'

function addRandomEdges(
  document: GraphDocument,
  i: number,
  random: () => number,
) {
  if (i && random() > 0.12) {
    const first = Math.floor(random() * i)
    document.edges.push({
      id: `${first}-${i}`,
      source: `n${first}`,
      target: `n${i}`,
    })
    if (random() < 0.3 && i > 2) {
      const second = Math.floor(random() * i)
      if (second !== first)
        document.edges.push({
          id: `${second}-${i}`,
          source: `n${second}`,
          target: `n${i}`,
        })
    }
  }
}
