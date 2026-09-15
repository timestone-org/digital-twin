/** @fileoverview 模型动画目录及其驱动节点。 */
import * as THREE from 'three'
export interface ModelAnimationEntry {
  name: string
  duration: number
  nodes: readonly string[]
  ambiguous: boolean
}
export function modelAnimationCatalog(
  clips: readonly THREE.AnimationClip[],
): ModelAnimationEntry[] {
  return clips
    .map((clip) => ({
      name: clip.name,
      duration: clip.duration,
      ambiguous:
        clip.name.trim() === '' ||
        clips.filter((item) => item.name === clip.name).length > 1,
      nodes: [
        ...new Set(
          clip.tracks.flatMap((track) => {
            try {
              const name = THREE.PropertyBinding.parseTrackName(
                track.name,
              ).nodeName
              return name === undefined || name === '' ? [] : [name]
            } catch {
              return []
            }
          }),
        ),
      ],
    }))
    .filter(
      (entry, index, all) =>
        all.findIndex((item) => item.name === entry.name) === index,
    )
}
