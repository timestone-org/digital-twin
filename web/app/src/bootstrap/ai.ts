/**
 * @fileoverview AI 子系统的启动装配。
 *
 * ⚠ **不调它 = 整个子系统不存在**：入口不出现、代码不进首屏包、工作面注册表
 * 空着。某些现场根本不部署 ai-assistant，那时这一行就是唯一要改的地方
 * （features/ai/ports.ts 记了三层「关掉」各管什么）。
 *
 * ⚠ 与 `installDashboardModules` 一样带幂等守卫：重复调不会出错，但会把同一份
 * 口子反复覆盖，而那让「到底装的是哪一份」在多入口的页面上说不清。
 */
import { advanceTurn, probeCapability } from '@/api/assistant'
import { setAiPorts } from '@/features/ai/ports'

let installed = false

/** 把助手的口子装上；重复调用只做第一次。 */
export function installAiAssistant(): void {
  if (installed) return
  installed = true
  setAiPorts({ probe: probeCapability, advance: advanceTurn })
}

/** 只给测试用：让「只装一次」这条判定回到初始状态。 */
export function __resetAiBootstrap(): void {
  installed = false
}
