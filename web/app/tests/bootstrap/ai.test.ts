/**
 * @fileoverview 契约：`installAiAssistant()` 是整个 AI 子系统的**唯一总开关**。
 *
 * 不调它，`aiPorts()` 恒空、`isAiInstalled()` 恒假、入口不出现——某些现场根本
 * 部署不了 ai-assistant，那时这一行就是唯一要改的地方。
 *
 * 另守幂等：重复调不出错，但也不许把口子反复覆盖，否则「到底装的是哪一份」
 * 在多入口的页面上说不清。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { advanceTurn, probeCapability } from '@/api/assistant'
import { __resetAiBootstrap, installAiAssistant } from '@/bootstrap/ai'
import { __resetAiPorts, aiPorts, isAiInstalled } from '@/features/ai/ports'

beforeEach(() => {
  __resetAiBootstrap()
  __resetAiPorts()
})

afterEach(() => {
  __resetAiBootstrap()
  __resetAiPorts()
})

describe('总开关', () => {
  it('没装之前一个口子都没有', () => {
    expect(isAiInstalled()).toBe(false)
    expect(aiPorts()).toBeNull()
  })

  it('装上之后探测与推进两个口子都在', () => {
    installAiAssistant()
    expect(isAiInstalled()).toBe(true)
    expect(aiPorts()?.probe).toBe(probeCapability)
    expect(aiPorts()?.advance).toBe(advanceTurn)
  })

  it('重复调只做第一次', () => {
    installAiAssistant()
    const first = aiPorts()
    installAiAssistant()
    // 反复覆盖会让「到底装的是哪一份」在多入口的页面上说不清
    expect(aiPorts()).toBe(first)
  })
})
