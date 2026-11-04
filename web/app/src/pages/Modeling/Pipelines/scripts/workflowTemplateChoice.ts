/** @fileoverview 创建工作流时内置模板与已保存模板的选择身份。 */
export interface WorkflowTemplateChoice {
  key: string
  label: string
}

const SAVED_PREFIX = 'saved:'

export function savedTemplateKey(id: string): string {
  return `${SAVED_PREFIX}${id}`
}

export function savedTemplateId(key: string): string | null {
  return key.startsWith(SAVED_PREFIX) && key.length > SAVED_PREFIX.length
    ? key.slice(SAVED_PREFIX.length)
    : null
}
