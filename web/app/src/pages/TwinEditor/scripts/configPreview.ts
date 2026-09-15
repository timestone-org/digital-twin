/** @fileoverview 从当前配置对象派生预览，原始草稿保持不变。 */
import { overlayPreviewOf, type ConfigPreview } from './previewContext'
import type { ModelAnimationEntry } from '@dt/three-core'
import {
  defaultCameraOf,
  normalizeAnimationControls,
  type TwinCamera,
  type TwinConfig,
  type TwinFocusView,
} from '@dt/twin-config'
import type { TwinSelection } from './types'

function previewConfig(
  config: TwinConfig,
  partId: string | null,
  isolated: boolean,
): TwinConfig {
  const effects = config.model.sceneEffects
  const parts =
    partId === null
      ? config.parts
      : config.parts
          .filter((part) => part.id === partId)
          .map((part) => ({
            ...part,
            visibility: {
              visible: true,
              hideAbove: null,
              hideBelow: null,
              fade: null,
            },
          }))
  return {
    ...config,
    model: {
      ...config.model,
      autoRotate: false,
      sceneEffects: isolated
        ? {
            ...effects,
            starfield: { ...effects.starfield, enabled: false },
            pedestal: { ...effects.pedestal, enabled: false },
            lightColumn: { ...effects.lightColumn, enabled: false },
          }
        : effects,
    },
    parts,
    anchors: isolated ? [] : config.anchors,
    panels: isolated ? [] : config.panels,
    arrows: isolated ? [] : config.arrows,
    flows: isolated ? [] : config.flows,
    viewpoints: { ...config.viewpoints, enabled: false },
    roamTour: { ...config.roamTour, enabled: false, autoplay: false },
  }
}
function titleOf(kind: string, name: string): string {
  return `${kind}预览 · ${name}`
}
function previewView(
  config: TwinConfig,
  camera: TwinCamera | undefined,
): TwinFocusView | null {
  const target = camera ?? defaultCameraOf(config.cameras)
  return target === null
    ? null
    : { position: target.position, target: target.target, fov: target.fov }
}
function sceneTitle(
  selection: TwinSelection,
  camera: TwinCamera | undefined,
): string {
  if (camera !== undefined) return titleOf('视点', camera.name || camera.id)
  return selection.kind === 'roam' ? '漫游配置预览' : '场景配置预览'
}
export function configPreviewOf(
  config: TwinConfig,
  selection: TwinSelection,
  animation: ModelAnimationEntry | null,
): ConfigPreview {
  const part =
    selection.kind === 'parts'
      ? config.parts.find((item) => item.id === selection.id)
      : undefined
  const camera =
    selection.kind === 'cameras'
      ? config.cameras.find((item) => item.id === selection.id)
      : undefined
  if (animation !== null) {
    const nodes = animation.nodes.length > 0 ? animation.nodes : undefined
    return {
      config: previewConfig(config, null, nodes !== undefined),
      nodes,
      view: null,
      title: titleOf('动画', animation.name),
    }
  }
  if (part !== undefined)
    return {
      config: previewConfig(config, part.id, true),
      nodes: part.nodes,
      view: null,
      title: titleOf('部件', part.name || part.id),
    }
  const overlay = overlayPreviewOf(
    previewConfig(config, null, false),
    selection,
  )
  if (overlay !== null) return overlay
  return {
    config: previewConfig(config, null, false),
    nodes: undefined,
    view: previewView(config, camera),
    title: sceneTitle(selection, camera),
  }
}
export function animationTestConfig(
  config: TwinConfig,
  clip: string | null,
  mode: 'live' | 'play' | 'pause' | 'reset',
): TwinConfig {
  if (clip === null || mode === 'live') return config
  const current = config.model.animations.controls.find(
    (control) => control.clip === clip,
  )
  const controls = normalizeAnimationControls([
    {
      ...current,
      clip,
      mode: mode === 'play' ? 'always' : 'point',
      threshold: 1,
      stop: mode === 'reset' ? 'reset' : 'pause',
      missing: mode === 'reset' ? 'reset' : 'pause',
      restart: false,
    },
  ])
  return {
    ...config,
    model: {
      ...config.model,
      animations: { enabled: false, clips: [], speed: 1, controls },
    },
  }
}
