/** @fileoverview 模型资源在大屏、素材库等入口共享应用的部署前缀。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resetTwinModelHost,
  resolveDracoDecoderPath,
  resolveTwinModelUrl,
} from '@dt/three-core/host'
import { installTwinModelHost } from '@/bootstrap/twinModelHost'

afterEach(() => {
  resetTwinModelHost()
  vi.unstubAllEnvs()
})

describe('模型宿主启动装配', () => {
  it.each(['/ai/', '/'])('解码器跟随 %s 部署前缀', (base) => {
    vi.stubEnv('BASE_URL', base)
    installTwinModelHost()
    expect(resolveDracoDecoderPath()).toBe(`${base}draco/`)
  })

  it('装配解码器时保留原有模型地址解析', () => {
    installTwinModelHost()
    expect(
      resolveTwinModelUrl('asset:0f9a2b3c-4d5e-4f70-8192-a3b4c5d6e7f8'),
    ).toContain('0f9a2b3c-4d5e-4f70-8192-a3b4c5d6e7f8')
  })
})
