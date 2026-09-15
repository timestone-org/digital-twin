/** @fileoverview 按真实配置引用建立对象间导航，不按名称猜测关系。 */
import type { TwinConfig } from '@dt/twin-config'
import type { ModelAnimationEntry } from '@dt/three-core'
import { TWIN_ENTITY_LABELS, type TwinSelection } from './types'
export interface RelatedObject {
  value: string
  label: string
  selection: TwinSelection | null
  animation: string | null
}
function entityLink(
  config: TwinConfig,
  kind: keyof typeof TWIN_ENTITY_LABELS,
  id: string,
  relation: string,
): RelatedObject[] {
  const item = config[kind].find((item) => item.id === id)
  return item === undefined
    ? []
    : [
        {
          value: `${kind}:${id}`,
          label: `${relation} · ${item.name || id}`,
          selection: { kind, id },
          animation: null,
        },
      ]
}
function linksOf(
  config: TwinConfig,
  selection: TwinSelection,
  clips: readonly ModelAnimationEntry[],
  animation: string | null,
): RelatedObject[] {
  if (animation !== null) {
    const nodes = clips.find((clip) => clip.name === animation)?.nodes ?? []
    return config.parts
      .filter((part) => part.nodes.some((node) => nodes.includes(node)))
      .flatMap((part) => entityLink(config, 'parts', part.id, '动画关联部件'))
  }
  if (!('id' in selection)) return []
  if (selection.kind === 'parts') return partLinks(config, selection.id, clips)
  return referenceLinks(config, selection)
}
function referenceLinks(
  config: TwinConfig,
  selection: Extract<TwinSelection, { id: string }>,
): RelatedObject[] {
  if (selection.kind === 'panels')
    return entityLink(
      config,
      'anchors',
      config.panels.find((panel) => panel.id === selection.id)?.anchorId ?? '',
      '绑定锚点',
    )
  if (selection.kind === 'anchors')
    return [
      ...config.panels
        .filter((panel) => panel.anchorId === selection.id)
        .flatMap((panel) =>
          entityLink(config, 'panels', panel.id, '关联信息牌'),
        ),
      ...config.flows
        .filter((flow) => flow.pathAnchors.includes(selection.id))
        .flatMap((flow) => entityLink(config, 'flows', flow.id, '关联能量流')),
    ]
  if (selection.kind === 'flows')
    return (
      config.flows.find((flow) => flow.id === selection.id)?.pathAnchors ?? []
    ).flatMap((id) => entityLink(config, 'anchors', id, '路径锚点'))
  if (selection.kind === 'cameras')
    return config.parts
      .filter((part) => part.click.cameraId === selection.id)
      .flatMap((part) =>
        entityLink(config, 'parts', part.id, '引用此视点的部件'),
      )
  return []
}

function partLinks(
  config: TwinConfig,
  id: string,
  clips: readonly ModelAnimationEntry[],
): RelatedObject[] {
  const part = config.parts.find((part) => part.id === id)
  if (part === undefined) return []
  return [
    ...entityLink(config, 'parts', part.parentId, '上级部件'),
    ...config.parts
      .filter((child) => child.parentId === id)
      .flatMap((child) => entityLink(config, 'parts', child.id, '子部件')),
    ...entityLink(config, 'cameras', part.click.cameraId, '关联视点'),
    ...clips
      .filter(
        (clip) =>
          !clip.ambiguous &&
          clip.nodes.some((node) => part.nodes.includes(node)),
      )
      .map((clip) => ({
        value: `animation:${clip.name}`,
        label: `关联动画 · ${clip.name}`,
        selection: null,
        animation: clip.name,
      })),
  ]
}
export function selectedObjectLabel(
  config: TwinConfig,
  selection: TwinSelection,
  animation: string | null,
): string {
  if (animation !== null)
    return `动画 · ${config.model.animations.controls.find((control) => control.clip === animation)?.name || animation}`
  if ('id' in selection)
    return `${TWIN_ENTITY_LABELS[selection.kind]} · ${config[selection.kind].find((item) => item.id === selection.id)?.name || selection.id}`
  return { model: '模型与场景', viewpoints: '视点切换', roam: '自动漫游' }[
    selection.kind
  ]
}

export function relatedObjects(
  config: TwinConfig,
  selection: TwinSelection,
  clips: readonly ModelAnimationEntry[],
  animation: string | null,
): RelatedObject[] {
  return [
    ...new Map(
      linksOf(config, selection, clips, animation).map((link) => [
        link.value,
        link,
      ]),
    ).values(),
  ]
}
