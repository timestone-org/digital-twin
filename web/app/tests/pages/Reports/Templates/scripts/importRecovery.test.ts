/** @fileoverview 导入恢复记录的账号隔离、秘密边界与存储故障容错。 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  readImportRecovery,
  writeImportRecovery,
} from '@/pages/Reports/Templates/scripts/importRecovery'

beforeEach(() => window.sessionStorage.clear())
afterEach(() => vi.restoreAllMocks())
it('只保存任务身份和名称编码，按账号隔离并支持清除', () => {
  expect(
    writeImportRecovery('a', { jobId: 'job-1', name: '月报', code: 'month' }),
  ).toBe(true)
  expect(readImportRecovery('a')).toEqual({
    jobId: 'job-1',
    name: '月报',
    code: 'month',
  })
  expect(readImportRecovery('b')).toBeNull()
  expect(writeImportRecovery('a', null)).toBe(true)
  expect(readImportRecovery('a')).toBeNull()
  expect(writeImportRecovery(null, null)).toBe(false)
  expect(readImportRecovery(null)).toBeNull()
})
it('损坏或超长记录不进入恢复流程', () => {
  window.sessionStorage.setItem('dt.report-import:a', '{')
  expect(readImportRecovery('a')).toBeNull()
  for (const value of [
    [],
    null,
    { jobId: '', name: '', code: '' },
    { jobId: 'a'.repeat(101), name: '', code: '' },
    { jobId: 'x', name: 4, code: '' },
    { jobId: 'x', name: '', code: 'a'.repeat(1001) },
  ]) {
    window.sessionStorage.setItem('dt.report-import:a', JSON.stringify(value))
    expect(readImportRecovery('a')).toBeNull()
  }
})
it('存储读取和写入异常不会中断导入功能', () => {
  vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
    throw new Error('disabled')
  })
  expect(readImportRecovery('a')).toBeNull()
  expect(writeImportRecovery('a', { jobId: 'x', name: '', code: '' })).toBe(
    false,
  )
})
