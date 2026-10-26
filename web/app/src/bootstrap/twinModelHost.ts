/** @fileoverview 模型资源地址与解码器部署路径的轻量启动装配。 */
import { modelVariantUrl } from '@dt/contracts'
import { configureTwinModelHost } from '@dt/three-core/host'

import { ASSET_BASE_URL } from '@/config/app'

export function installTwinModelHost(): void {
  configureTwinModelHost({
    dracoDecoderPath: `${import.meta.env.BASE_URL}draco/`,
    resolveModelUrl: (ref, variant) =>
      modelVariantUrl(ASSET_BASE_URL, ref, variant),
  })
}
