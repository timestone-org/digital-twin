/**
 * @fileoverview 锁住「孪生契约里的每个字段都有地方可改」。
 *
 * ⚠ 给 `TwinConfig` 加一个字段、却忘了在检查器上开一个控件，是一种完全静默的
 * 失败：归一化会给它一个缺省值，渲染层照常读，用户永远改不到它，也永远不知道
 * 有这么个东西。反过来，删字段时忘了删控件，控件会往配置里写一个谁也不读的键。
 *
 * ⚠ 这条按**源码里出现过这个字段名**判定，不保证控件真的接对了——它挡的是
 * 「整个漏掉」，不是「接错」。接错由各检查器自己的用例守。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const WEB_ROOT = process.cwd()
const TYPES = join(WEB_ROOT, 'packages', 'twin-config', 'src', 'types.ts')
const COMPONENTS = join(
  WEB_ROOT,
  'app',
  'src',
  'pages',
  'TwinEditor',
  'components',
)

/** 每个契约接口由哪个（或哪几个）文件负责让人改。 */
const OWNERS: Readonly<Record<string, readonly string[]>> = {
  TwinModelRef: ['inspector/ModelInspector.vue'],
  TwinModelAnimations: ['inspector/ModelInspector.vue'],
  TwinStarfield: ['fields/SceneEffectsFields.vue'],
  TwinPedestal: ['fields/SceneEffectsFields.vue'],
  TwinLightColumn: ['fields/SceneEffectsFields.vue'],
  TwinSceneEffects: ['fields/SceneEffectsFields.vue'],
  TwinPart: ['inspector/PartInspector.vue'],
  TwinClickDistanceRule: ['inspector/PartInspector.vue'],
  TwinPartLook: ['fields/PartLookFields.vue'],
  TwinPartTint: ['fields/PartTintFields.vue'],
  TwinTintGradient: ['fields/PartTintFields.vue'],
  TwinTintStop: ['fields/TintStopRow.vue'],
  TwinAnchor: ['inspector/AnchorInspector.vue'],
  TwinCamera: ['inspector/CameraInspector.vue'],
  TwinViewpointSwitcher: ['inspector/ViewpointsInspector.vue'],
  TwinRoamTour: [
    'inspector/RoamTourInspector.vue',
    'fields/RoamStopList.vue',
    'fields/RoamSegmentFields.vue',
  ],
  TwinRoamTourSegment: ['fields/RoamSegmentFields.vue'],
  TwinPanel: ['inspector/PanelInspector.vue'],
  TwinPanelStyle: ['inspector/PanelStyleFields.vue'],
  TwinPanelField: ['fields/PanelFieldList.vue', 'fields/PanelFieldGraph.vue'],
  TwinPanelLevel: ['fields/PanelFieldGraph.vue'],
  TwinArrow: ['inspector/ArrowInspector.vue'],
  TwinFlowLink: ['inspector/FlowInspector.vue'],
  TwinHierNode: ['inspector/HierNodeInspector.vue', 'fields/HierFieldList.vue'],
  TwinModalView: ['inspector/HierNodeInspector.vue'],
  TwinVisibilityRule: ['fields/VisibilityFields.vue'],
  TwinVisibilityFade: ['fields/VisibilityFields.vue'],
  TwinDistanceRule: ['fields/DistanceField.vue'],
  // 文件夹不走检查器，经大纲行菜单编辑；itemIds 的写入实现在 folderOps
  TwinOutlineFolder: [
    'OutlineFolderRow.vue',
    'TwinOutline.vue',
    '../scripts/folderOps.ts',
  ],
}

/** id 由编辑器生成、不给人改；version 是格式版本。 */
const NOT_EDITABLE = new Set(['id', 'version'])

/**
 * 当前渲染方式下画不出来、因而刻意不给控件的字段。
 * ⚠ 契约字段本身留着（存量数据照常读得出来），撤的只是那个不生效的开关——
 * 摆一个配了没反应的控件比没有更糟。要往这里加，先确认「用户配了它画面上会变吗」，
 * 会变就是缺陷不是豁免。同一批字段在 `twin-config-consumed.contract.spec.ts`
 * 的 KNOWN_DEAD 里各有一条对应的原因。
 */
const NO_CONTROL_ON_PURPOSE = new Set([
  // 本项目从不做统一提亮，这个开关恒等于 true 的行为
  'originalMaterials',
])

function interfaceFields(source: string): Map<string, string[]> {
  const found = new Map<string, string[]>()
  for (const block of source.matchAll(/export interface (\w+) \{(.*?)\n\}/gs)) {
    const [, name = '', body = ''] = block
    found.set(
      name,
      [...body.matchAll(/^ {2}(\w+)\??:/gm)].map(([, key = '']) => key),
    )
  }
  return found
}

const FIELDS = interfaceFields(readFileSync(TYPES, 'utf8'))

/** 这些接口是取值用的，不是配置；不进覆盖检查。 */
const VALUE_SHAPES = /Values?$/

/**
 * 由配置 + 实时值现算出来的形状，不是配置本身，因而没有「在哪改」可言。
 * ⚠ 与上面的取值形状分开列：它们不叫 `*Value(s)`，靠命名认不出来。
 */
const DERIVED_SHAPES = new Set(['TwinPartAppearance'])

const checked = [...FIELDS.keys()].filter(
  (name) =>
    !VALUE_SHAPES.test(name) &&
    !DERIVED_SHAPES.has(name) &&
    name !== 'TwinConfig',
)

describe('检查器覆盖了整份孪生契约', () => {
  // 加了新接口却没登记归谁管，等于悄悄退出了这条契约
  it.each(checked)('%s 有人负责', (name) => {
    expect(Object.keys(OWNERS)).toContain(name)
  })

  it.each(Object.entries(OWNERS))('%s 的每个字段都能改', (name, owners) => {
    const fields = FIELDS.get(name) ?? []
    expect(fields.length).toBeGreaterThan(0)

    const sources = owners
      .map((rel) => readFileSync(join(COMPONENTS, rel), 'utf8'))
      .join('\n')
    const missing = fields.filter(
      (field) =>
        !NOT_EDITABLE.has(field) &&
        !NO_CONTROL_ON_PURPOSE.has(field) &&
        !new RegExp(`\\b${field}\\b`).test(sources),
    )

    expect(missing).toEqual([])
  })
})
