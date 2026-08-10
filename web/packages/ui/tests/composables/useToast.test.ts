/**
 * @fileoverview 消息队列的契约：入队、按 intent 取默认时长、到点自动消失、
 * 手动关掉后不再有待触发的定时器。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useToast } from '../../src/composables/useToast'

beforeEach(() => {
  useToast().clear()
  vi.useFakeTimers()
})

afterEach(() => {
  useToast().clear()
  vi.useRealTimers()
})

describe('useToast', () => {
  it('入队后能读到', () => {
    const toast = useToast()
    toast.success('已保存')
    expect(toast.toasts.value).toHaveLength(1)
    expect(toast.toasts.value[0]?.message).toBe('已保存')
    expect(toast.toasts.value[0]?.intent).toBe('success')
  })

  it('全应用共用同一个队列', () => {
    useToast().info('甲')
    expect(useToast().toasts.value).toHaveLength(1)
  })

  it('成功类到点自动消失', () => {
    const toast = useToast()
    toast.success('已保存')
    vi.advanceTimersByTime(3500)
    expect(toast.toasts.value).toHaveLength(0)
  })

  it('失败类停留更久——失败信息要读完', () => {
    const toast = useToast()
    toast.error('保存失败')
    vi.advanceTimersByTime(3500)
    expect(toast.toasts.value).toHaveLength(1)
    vi.advanceTimersByTime(2500)
    expect(toast.toasts.value).toHaveLength(0)
  })

  it('duration=0 不自动消失，要用户自己关', () => {
    const toast = useToast()
    toast.info('要点确认的事', { duration: 0 })
    vi.advanceTimersByTime(60_000)
    expect(toast.toasts.value).toHaveLength(1)
  })

  it('手动关掉后，原来的定时器不再动别人', () => {
    const toast = useToast()
    const id = toast.info('甲')
    toast.dismiss(id)
    toast.info('乙')
    vi.advanceTimersByTime(3499)
    // 甲的定时器若还活着，这一刻会把乙误删
    expect(toast.toasts.value.map((item) => item.message)).toEqual(['乙'])
  })

  it('title 可选，缺省不渲染标题', () => {
    const toast = useToast()
    toast.warning('注意', { title: '权限变更' })
    expect(toast.toasts.value[0]?.title).toBe('权限变更')
  })

  it('多条按入队顺序排列', () => {
    const toast = useToast()
    toast.info('甲')
    toast.info('乙')
    expect(toast.toasts.value.map((item) => item.message)).toEqual(['甲', '乙'])
  })

  it('clear 一次清空并停掉全部定时器', () => {
    const toast = useToast()
    toast.info('甲')
    toast.info('乙')
    toast.clear()
    expect(toast.toasts.value).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
