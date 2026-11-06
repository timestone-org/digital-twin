/** @fileoverview 孪生编辑器保存的重入保护，工具栏与助手工具共走一条保存路径。 */

/**
 * 给保存加重入保护：在途时不另发请求，等它的结果。
 * ⚠ 不能回 false：助手的保存工具会把用户那次成功的保存报成失败。
 * ⚠ 在途那次的快照之后又改过就再存一次，否则调用方的改动没落库却拿到成功。
 * @param start 真正发起一次保存
 * @param isDirty 当前文档是否还有没落库的改动
 */
export function createReentrantSave(
  start: () => Promise<boolean>,
  isDirty: () => boolean,
): () => Promise<boolean> {
  let inFlight: Promise<boolean> | null = null

  return async function save(): Promise<boolean> {
    if (inFlight === null) {
      inFlight = start().finally(() => {
        inFlight = null
      })
      return await inFlight
    }
    const isSaved = await inFlight
    return isSaved && isDirty() ? await save() : isSaved
  }
}
