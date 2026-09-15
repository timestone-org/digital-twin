/** @fileoverview 覆盖层与漫游的配置预览上下文。 */
import {
  ALWAYS_VISIBLE,
  buildRoamSegments,
  type TwinFocusView,
  type TwinConfig,
  type TwinVisibilityRule,
} from '@dt/twin-config'
import type { TwinSelection } from './types'
export interface ConfigPreview {
  config: TwinConfig
  nodes: readonly string[] | undefined
  view: TwinFocusView | null
  title: string
  target?: TwinSelection
}
function selectedVisible<
  T extends { id: string; visibility: TwinVisibilityRule },
>(items: readonly T[], selected: boolean, id: string): T[] {
  return items
    .filter((item) => selected && item.id === id)
    .map((item) => ({ ...item, visibility: ALWAYS_VISIBLE }))
}
export function overlayPreviewOf(
  config: TwinConfig,
  selection: TwinSelection,
): ConfigPreview | null {
  if (!('id' in selection)) return null
  const kind = selection.kind
  if (
    kind !== 'panels' &&
    kind !== 'anchors' &&
    kind !== 'arrows' &&
    kind !== 'flows'
  )
    return null
  const item = config[kind].find((item) => item.id === selection.id)
  if (item === undefined) return null
  const title = {
    panels: '信息牌',
    anchors: '锚点',
    arrows: '箭头',
    flows: '能量流',
  }[kind]
  return {
    config: {
      ...config,
      anchors: config.anchors.map((anchor) =>
        anchor.id === selection.id && kind === 'anchors'
          ? { ...anchor, visibility: ALWAYS_VISIBLE }
          : anchor,
      ),
      panels: selectedVisible(config.panels, kind === 'panels', item.id),
      arrows: selectedVisible(config.arrows, kind === 'arrows', item.id),
      flows: selectedVisible(config.flows, kind === 'flows', item.id),
    },
    nodes: undefined,
    view: null,
    target: selection,
    title: `${title}预览 · ${item.name || item.id}`,
  }
}
export function roamPreviewOf(
  config: TwinConfig,
  segmentKey: string,
): TwinConfig {
  const segments = buildRoamSegments(config.cameras, config.roamTour)
  const segment = segments.find(
    (item) => `${item.fromId}:${item.toId}` === segmentKey,
  )
  return {
    ...config,
    roamTour: {
      ...config.roamTour,
      enabled: true,
      autoplay: false,
      idleAutoplay: false,
      showControls: true,
      ...(segment === undefined
        ? {}
        : { items: [segment.fromId, segment.toId], loop: false }),
    },
  }
}
