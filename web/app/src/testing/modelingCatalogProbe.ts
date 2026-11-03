/** @fileoverview 从当前Python注册表读取测试目录，并把真实表单配置送回算子边界。 */
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ModelingOperator, ModelingPort } from '@dt/contracts'

const SERVICE = join(process.cwd(), '../server/services/platform-server')
const CATALOG = `
import json, sys
sys.path.insert(0, 'tests')
from contract.test_modeling_report_coverage import cases
from platform_server.apps.modeling.operators import Frame, registry
entries = []
for code, (inputs, seed) in cases().items():
    columns = {}
    for value in inputs.values():
        if isinstance(value, Frame):
            columns.update({column.key: column.name for column in value.columns})
    entries.append(dict(operator=registry.get(code).spec().model_dump(), seed=seed,
                        columns=[dict(key=k, name=v) for k, v in columns.items()]))
print(json.dumps(entries, ensure_ascii=False, allow_nan=False))
`
const VALIDATE = `
import json, sys, warnings
from pathlib import Path
sys.path.insert(0, 'tests')
from contract.test_modeling_report_coverage import cases
from platform_server.apps.modeling.operators import registry
from platform_server.apps.modeling.services import preview, report_budget
inputs_by_code = cases()
results, errors = [], []
for item in json.loads(Path(sys.argv[1]).read_text()):
    try:
        operator, config = registry.build(item['code'], item['config'])
        if item.get('run'):
            operator.bind_runtime(tz_offset_minutes=480, split_plan=None)
            with warnings.catch_warnings():
                warnings.simplefilter('ignore')
                outputs = operator.run(inputs_by_code[item['code']][0])
            payload = {port: preview.fit_budget(preview.summarize(value))[0]
                       for port, value in outputs.items()}
            results.append(dict(code=item['code'], config=config.model_dump(mode='json'),
                                payload=payload, report=report_budget.fit_report(operator.report())))
    except Exception as error:
        errors.append(dict(code=item['code'], config=item['config'], error=str(error)))
print(json.dumps(dict(results=results, errors=errors), ensure_ascii=False, allow_nan=False))
`

export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('缺少注册表对象')
  return Object.fromEntries<unknown>(Object.entries(value))
}
export function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('缺少注册表数组')
  return value
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('缺少注册表文字')
  return value
}
function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('缺少注册表布尔值')
  return value
}
function port(value: unknown): ModelingPort {
  const raw = object(value)
  return {
    name: text(raw['name']),
    contract: text(raw['contract']),
    label: text(raw['label']),
    description: text(raw['description']),
    is_required: flag(raw['is_required']),
  }
}
function operator(value: unknown): ModelingOperator {
  const raw = object(value)
  return {
    code: text(raw['code']),
    name: text(raw['name']),
    description: text(raw['description']),
    category: text(raw['category']),
    spec_version: text(raw['spec_version']),
    icon: text(raw['icon']),
    config_schema: object(raw['config_schema']),
    inputs: list(raw['inputs']).map(port),
    outputs: list(raw['outputs']).map(port),
    fit_required: flag(raw['fit_required']),
    serving_enabled: flag(raw['serving_enabled']),
    serving_channel: text(raw['serving_channel']),
    serving_window_required: flag(raw['serving_window_required']),
  }
}
export interface CatalogEntry {
  operator: ModelingOperator
  seed: Record<string, unknown>
  columns: { key: string; name: string }[]
}
async function python(source: string, args: string[] = []): Promise<unknown> {
  const execute = promisify(execFile)
  const { stdout } = await execute(
    'uv',
    ['run', '--no-sync', 'python', '-c', source, ...args],
    {
      cwd: SERVICE,
      timeout: 60_000,
      maxBuffer: 32 * 1024 * 1024,
    },
  )
  const parsed: unknown = JSON.parse(stdout)
  return parsed
}
export async function freshCatalog(): Promise<CatalogEntry[]> {
  return list(await python(CATALOG)).map((value) => {
    const raw = object(value)
    return {
      operator: operator(raw['operator']),
      seed: object(raw['seed']),
      columns: list(raw['columns']).map((value) => {
        const column = object(value)
        return { key: text(column['key']), name: text(column['name']) }
      }),
    }
  })
}
export interface ConfigSubmission {
  code: string
  config: Record<string, unknown>
  run?: boolean
}
export async function backendResults(configs: ConfigSubmission[]) {
  const directory = await mkdtemp(join(tmpdir(), 'dt-config-contract-'))
  try {
    const path = join(directory, 'configs.json')
    await writeFile(path, JSON.stringify(configs))
    const raw = object(await python(VALIDATE, [path]))
    return {
      errors: list(raw['errors']),
      results: list(raw['results']).map((value) => {
        const item = object(value)
        return {
          code: text(item['code']),
          config: object(item['config']),
          payload: object(item['payload']),
          report: object(item['report']),
        }
      }),
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
