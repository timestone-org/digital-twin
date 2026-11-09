/** @fileoverview 实例配置草稿上改一个节点的一项参数。 */
import type { EditorState } from './instanceState'

/** 把一项参数写进 JSON 草稿；草稿解析不了时不动。 */
export function changeDraft(
  state: EditorState,
  node: string,
  key: string,
  value: unknown,
): void {
  const configuration = state.parsed.value.value
  if (configuration)
    state.draft.value = JSON.stringify(
      {
        nodes: {
          ...configuration.nodes,
          [node]: { ...configuration.nodes[node], [key]: value },
        },
      },
      null,
      2,
    )
}
