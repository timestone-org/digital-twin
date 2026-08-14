/**
 * @fileoverview 工作台上次选中的项目的读写。
 *
 * ⚠ 存 id 不存下标：项目增删或重排之后，下标会指到另一个项目上。
 * ⚠ 读写都可能抛（Safari 无痕、配额满），丢一个偏好不该把落地页带崩，
 * 因此两侧都吞掉异常并退化成「每次进来选第一个」。
 */
import { STORAGE_KEYS } from '@/config/storage'

/** 上次选中的项目 id；没存过或存储不可用时给 null。 */
export function readLastProject(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.lastProject)
    return raw === null || raw.trim() === '' ? null : raw
  } catch {
    return null
  }
}

/**
 * 记下当前选中的项目。
 * @param projectId 项目 id，null 表示清掉记录
 */
export function writeLastProject(projectId: string | null): void {
  try {
    if (projectId === null) localStorage.removeItem(STORAGE_KEYS.lastProject)
    else localStorage.setItem(STORAGE_KEYS.lastProject, projectId)
  } catch {
    /* 存不下就只在本次会话内有效 */
  }
}
