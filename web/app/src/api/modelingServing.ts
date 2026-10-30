/** @fileoverview 使用当前账号读取部署签名并试算线上模型。 */
import type {
  OpenModelDetectRequest,
  OpenModelCalculate,
  OpenModelDetect,
  OpenModelPredict,
} from '@dt/contracts'
import { PLATFORM_BASE_URL } from '@/config/app'
import { requestData } from './client'

export type ModelingServingAction = 'predict' | 'detect' | 'calculate'

export function getOpenModelSignature(
  code: string,
  signal?: AbortSignal,
): Promise<unknown> {
  return requestData<unknown>(`/open-models/${encodeURIComponent(code)}`, {
    baseUrl: PLATFORM_BASE_URL,
    signal,
  })
}

export function callOpenModel(
  code: string,
  action: ModelingServingAction,
  rows: OpenModelDetectRequest['rows'],
  signal?: AbortSignal,
): Promise<OpenModelPredict | OpenModelDetect | OpenModelCalculate> {
  return requestData(`/open-models/${encodeURIComponent(code)}:${action}`, {
    baseUrl: PLATFORM_BASE_URL,
    method: 'POST',
    body: { rows },
    signal,
  })
}
