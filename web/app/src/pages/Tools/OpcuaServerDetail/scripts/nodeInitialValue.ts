/** @fileoverview 按本部署的 OPC UA 运行时类型解析节点初值。 */
import type { OpcuaDataType } from '@dt/contracts'

export const CREATABLE_DATA_TYPES: readonly OpcuaDataType[] = [
  'boolean',
  'int32',
  'int64',
  'float',
  'double',
  'string',
  'byte_string',
]

export interface ParsedInitialValue {
  value: string | number | boolean | undefined
  error: string | null
}

/** 解析初值文本；留空沿用后端零值。@param raw @param dataType */
export function parseInitialValue(
  raw: string,
  dataType: OpcuaDataType,
): ParsedInitialValue {
  if (!CREATABLE_DATA_TYPES.includes(dataType))
    return { value: undefined, error: '本部署尚不支持此数据类型' }
  if (raw === '') return { value: undefined, error: null }
  if (dataType === 'string' || dataType === 'byte_string')
    return { value: raw, error: null }
  const text = raw.trim()
  if (text === '') return { value: undefined, error: null }
  if (dataType === 'boolean') return parseBoolean(text)
  if (dataType === 'int32' || dataType === 'int64')
    return parseInteger(text, dataType)
  return parseReal(text, dataType)
}

/** 布尔文本只允许 true 与 false。@param text */
function parseBoolean(text: string): ParsedInitialValue {
  if (text === 'true' || text === 'false')
    return { value: text === 'true', error: null }
  return { value: undefined, error: '布尔初值请输入 true 或 false' }
}

/** 检查有限数值和 OPC UA float 的编码范围。@param text @param dataType */
function parseReal(text: string, dataType: OpcuaDataType): ParsedInitialValue {
  const value = Number(text)
  if (
    !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) ||
    !Number.isFinite(value)
  )
    return { value: undefined, error: '数值初值请输入有限数字' }
  if (dataType === 'float' && !Number.isFinite(Math.fround(value)))
    return { value: undefined, error: 'float 初值超出有限32位浮点范围' }
  return { value, error: null }
}

/** 检查整数范围与浏览器 JSON 精度。@param text @param dataType */
function parseInteger(
  text: string,
  dataType: 'int32' | 'int64',
): ParsedInitialValue {
  const value = Number(text)
  if (!/^[+-]?\d+$/.test(text) || !Number.isSafeInteger(value))
    return {
      value: undefined,
      error: '整数初值须为安全整数（绝对值不超过 9007199254740991）',
    }
  if (dataType === 'int32' && (value < -2147483648 || value > 2147483647))
    return {
      value: undefined,
      error: 'int32 初值范围为 -2147483648 至 2147483647',
    }
  return { value, error: null }
}
