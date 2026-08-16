/**
 * @fileoverview 点位的 CSV 导入导出：模板、解析、校验与回写。
 *
 * 为什么是 CSV 而不是 xlsx：xlsx 要引一个几百 KB 的解析库，而现场拿到的点表
 * 十有八九是从组态软件导出的 CSV。带 BOM 的 UTF-8 CSV 在 Excel 里双击就能开、
 * 改完另存回 CSV，闭环是通的。
 *
 * ⚠ 三处「静默出错数」的坑，逐条都有对应的校验：
 * 1. **BOM**：Excel 存的 UTF-8 CSV 开头有一个 U+FEFF。不剥掉它，第一列表头
 *    就成了「U+FEFF + code」，整表被判为「缺少 code 列」，而肉眼看完全正常。
 * 2. **Excel 的科学计数**：`1E5` 这种寻址串被 Excel 存成 `100000`。这里不做
 *    还原（还原等于猜），但会把它当普通字符串原样上传——错的是导出那一步。
 * 3. **同名编码**：文件内重复与库里已存是两件事，提示必须分开——前者要用户
 *    改文件，后者可以选择跳过。
 */
import type {
  CollectDataType,
  CollectPoint,
  CollectPointItemInput,
} from '@dt/contracts'
import { COLLECT_DATA_TYPES, COLLECT_MIN_INTERVAL_MS } from '@dt/contracts'

/** UTF-8 BOM。写出去让 Excel 认出编码，读进来先剥掉。 */
const BOM = '\uFEFF'

/** 列名与它在界面上的叫法。顺序就是模板里的列序。 */
export const CSV_COLUMNS = [
  { key: 'code', label: '点位编码', required: true },
  { key: 'name', label: '名称', required: true },
  { key: 'address', label: '寻址串', required: true },
  { key: 'data_type', label: '数据类型', required: false },
  { key: 'unit', label: '单位', required: false },
  { key: 'sampling_interval_ms', label: '采样周期(ms)', required: false },
  { key: 'deadband', label: '死区', required: false },
  { key: 'archive_enabled', label: '归档', required: false },
  { key: 'archive_max_interval_ms', label: '归档心跳(ms)', required: false },
  { key: 'archive_retention_days', label: '保留天数', required: false },
] as const

type ColumnKey = (typeof CSV_COLUMNS)[number]['key']

/** 表头允许写中文标签，也允许写英文字段名——两种都认。 */
const HEADER_ALIASES = new Map<string, ColumnKey>(
  CSV_COLUMNS.flatMap((column) => [
    [column.key, column.key] as const,
    [column.label, column.key] as const,
  ]),
)

/** 模板里的示例行。有一行样例，用户才知道寻址串长什么样。 */
const SAMPLE_ROWS: readonly string[][] = [
  [
    'outlet_temp',
    '出口温度',
    'ns=2;s=Plant1.Line1.OutletTemp',
    'float',
    '℃',
    '1000',
    '0.5',
    '是',
    '60000',
    '',
  ],
  [
    'run_state',
    '运行状态',
    'ns=2;s=Plant1.Line1.Running',
    'bool',
    '',
    '1000',
    '0',
    '是',
    '60000',
    '90',
  ],
]

/** 一行解析结果：要么是可提交的点位，要么是一条看得懂的错。 */
export interface ParsedRow {
  /** 文件里的行号，从 1 开始且**不含表头**——报错要指得回去。 */
  line: number
  item: CollectPointItemInput | null
  error: string | null
}

export interface ParseResult {
  rows: ParsedRow[]
  /** 整表级别的错（缺列、空文件）。有它时 `rows` 一定是空的。 */
  fatal: string | null
}

/** 一个字段被写成的样子 → 布尔。认不出的一律当成没写。 */
const TRUE_WORDS = new Set(['1', 'true', 'yes', '是', 'y', 'on'])
const FALSE_WORDS = new Set(['0', 'false', 'no', '否', 'n', 'off'])

/**
 * 拆一行 CSV，认双引号包裹与 `""` 转义。
 * ⚠ 不用 `split(',')`：寻址串里带逗号是常事（`ns=2;s=A,B`），一刀切会把一列
 * 劈成两列，而多出来的那列会静默顶掉后面所有字段。
 * @param line 一行原文
 */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (quoted) {
      if (char !== '"') {
        cell += char
      } else if (line[index + 1] === '"') {
        cell += '"'
        index += 1
      } else {
        quoted = false
      }
      continue
    }
    if (char === '"') quoted = true
    else if (char === ',') {
      cells.push(cell)
      cell = ''
    } else cell += char
  }
  cells.push(cell)
  return cells
}

/** 把一格写成 CSV 安全的形式。 */
function quote(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell
}

function toLines(text: string): string[] {
  // ⚠ 先剥 BOM 再按行切：留着它，第一列表头永远匹配不上
  const body = text.startsWith(BOM) ? text.slice(BOM.length) : text
  return body
    .split(/\r\n|\n|\r/)
    .filter((line, index) => index === 0 || line.trim() !== '')
}

/**
 * 解析整份 CSV。
 * @param text 文件原文
 */
export function parsePointCsv(text: string): ParseResult {
  const lines = toLines(text)
  const header = lines[0]
  if (header === undefined || header.trim() === '') {
    return { rows: [], fatal: '文件是空的' }
  }
  const columns = splitCsvLine(header).map(
    (cell) => HEADER_ALIASES.get(cell.trim()) ?? null,
  )
  const missing = CSV_COLUMNS.filter(
    (column) => column.required && !columns.includes(column.key),
  )
  if (missing.length > 0) {
    return {
      rows: [],
      fatal: `表头缺少必填列：${missing.map((item) => item.label).join('、')}`,
    }
  }
  const rows = lines
    .slice(1)
    .map((line, index) => parseRow(splitCsvLine(line), columns, index + 1))
  return {
    rows,
    fatal: rows.length === 0 ? '文件里只有表头，没有数据行' : null,
  }
}

function parseRow(
  cells: readonly string[],
  columns: readonly (ColumnKey | null)[],
  line: number,
): ParsedRow {
  const values = new Map<ColumnKey, string>()
  columns.forEach((key, index) => {
    if (key !== null) values.set(key, (cells[index] ?? '').trim())
  })
  try {
    return { line, item: buildItem(values), error: null }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : '这一行读不了'
    return { line, item: null, error: message }
  }
}

function buildItem(values: Map<ColumnKey, string>): CollectPointItemInput {
  const code = required(values, 'code', '点位编码')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(code)) {
    throw new Error(`点位编码「${code}」只能用字母、数字与 . _ -`)
  }
  // ⚠ 编码里不许有冒号：点位身份按第一个冒号切分，带冒号的编码会让身份解析
  // 出一个不存在的数据源（docs/COLLECT_DESIGN.md §2）
  const unit = values.get('unit') ?? ''
  return {
    code,
    name: required(values, 'name', '名称'),
    address: required(values, 'address', '寻址串'),
    data_type: dataType(values.get('data_type') ?? ''),
    unit: unit === '' ? null : unit,
    sampling_interval_ms: positive(
      values.get('sampling_interval_ms') ?? '',
      1000,
      COLLECT_MIN_INTERVAL_MS,
      '采样周期',
    ),
    deadband: nonNegative(values.get('deadband') ?? '', 0, '死区'),
    archive_enabled: bool(values.get('archive_enabled') ?? '', true),
    archive_max_interval_ms: positive(
      values.get('archive_max_interval_ms') ?? '',
      60_000,
      1,
      '归档心跳',
    ),
    archive_retention_days: retention(
      values.get('archive_retention_days') ?? '',
    ),
  }
}

function required(
  values: Map<ColumnKey, string>,
  key: ColumnKey,
  label: string,
): string {
  const cell = values.get(key) ?? ''
  if (cell === '') throw new Error(`${label}不能为空`)
  return cell
}

function dataType(cell: string): CollectDataType {
  if (cell === '') return 'float'
  const found = COLLECT_DATA_TYPES.find((type) => type === cell.toLowerCase())
  if (found === undefined) {
    throw new Error(
      `数据类型「${cell}」不认识，只能是 ${COLLECT_DATA_TYPES.join(' / ')}`,
    )
  }
  return found
}

function bool(cell: string, fallback: boolean): boolean {
  if (cell === '') return fallback
  const word = cell.toLowerCase()
  if (TRUE_WORDS.has(word)) return true
  if (FALSE_WORDS.has(word)) return false
  throw new Error(`「${cell}」看不出是不是，请写「是」或「否」`)
}

function positive(
  cell: string,
  fallback: number,
  floor: number,
  label: string,
): number {
  if (cell === '') return fallback
  const value = Number(cell)
  if (!Number.isFinite(value) || value < floor) {
    throw new Error(`${label}要是不小于 ${floor} 的数字，现在是「${cell}」`)
  }
  return Math.round(value)
}

function nonNegative(cell: string, fallback: number, label: string): number {
  if (cell === '') return fallback
  const value = Number(cell)
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label}要是不小于 0 的数字，现在是「${cell}」`)
  }
  return value
}

function retention(cell: string): number | null {
  if (cell === '') return null
  const value = Number(cell)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`保留天数要是正整数，现在是「${cell}」`)
  }
  return Math.round(value)
}

/** 找出文件里自己撞了的编码。⚠ 与「库里已存」是两件事，提示分开给。 */
export function duplicatedCodes(rows: readonly ParsedRow[]): string[] {
  const seen = new Set<string>()
  const duplicated = new Set<string>()
  for (const row of rows) {
    const code = row.item?.code
    if (code === undefined) continue
    if (seen.has(code)) duplicated.add(code)
    seen.add(code)
  }
  return [...duplicated].sort()
}

function csvOf(rows: readonly (readonly string[])[]): string {
  const body = rows.map((row) => row.map(quote).join(',')).join('\r\n')
  // ⚠ BOM 不能省：没有它，Excel 按本地代码页解，中文表头全是乱码
  return `${BOM}${body}\r\n`
}

/** 批量导入用的模板：一行表头 + 两行样例。 */
export function templateCsv(): string {
  return csvOf([CSV_COLUMNS.map((column) => column.label), ...SAMPLE_ROWS])
}

/**
 * 把现有点位导成同一套列的 CSV，改完能原样导回来。
 * @param points 要导出的点位
 */
export function pointsToCsv(points: readonly CollectPoint[]): string {
  const rows = points.map((point) => [
    point.code,
    point.name,
    point.address,
    point.data_type,
    point.unit ?? '',
    String(point.sampling_interval_ms),
    String(point.deadband),
    point.archive_enabled ? '是' : '否',
    String(point.archive_max_interval_ms),
    point.archive_retention_days === null
      ? ''
      : String(point.archive_retention_days),
  ])
  return csvOf([CSV_COLUMNS.map((column) => column.label), ...rows])
}
