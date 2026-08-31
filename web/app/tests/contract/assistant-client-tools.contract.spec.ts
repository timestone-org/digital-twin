/**
 * @fileoverview 把「客户端工具两侧逐字同名」这条不变量钉住。
 *
 * 客户端工具的规格在 ai-assistant，实现在浏览器里的各工作面。两处各写一份名字，
 * 而任一方向漂开都**没有任何运行期迹象**：
 * - 页面报了一个后端没有规格的名字 → 模型永远看不见它，那段实现是死代码；
 * - 后端有规格而没有页面实现 → 模型看得见、调一次失败一次，失败的样子与
 *   「这一页没实现它」一模一样；
 * - 技能声明了它的工作面没实现的工具 → 老前端那条按技能推导的退回路径会把它
 *   发出去，同样是调一次失败一次。
 *
 * 三个方向都在这里对。⚠ 对着 Python 源码比而不是 openapi：工具规格不出 HTTP 面，
 * 它随每一轮的提示词下发。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ASSISTANT_ASK_TOOL } from '@dt/contracts'

import { BUILTIN_CLIENT_TOOLS } from '@/features/ai/builtinTools'
import { EDITOR_TOOLS } from '@/pages/DashboardEditor/scripts/aiSurface'
import { TABLE_TOOLS } from '@/pages/Dataset/TableDetail/scripts/aiSurface'
import { TWIN_TOOLS } from '@/pages/TwinEditor/scripts/aiSurface'
import { TWIN_2D_TOOLS } from '@/pages/Twin2dEditor/scripts/aiSurface'

// ⚠ 用 process.cwd()（= web/）而不是 import.meta.url：happy-dom 下后者不是 file URL
const CHAT_DIR = join(
  process.cwd(),
  '..',
  'server',
  'services',
  'ai-assistant',
  'src',
  'ai_assistant',
  'apps',
  'chat',
)

/** 规格分住这几个模块；加了新的一份要记得挂进来，否则这道闸只对了一半。 */
const SPEC_FILES = [
  'client_tool_specs.py',
  'client_tool_specs_interaction.py',
  'client_tool_specs_look.py',
]

/** 工作面 → 那一页自报实现了哪些工具。 */
const SURFACE_TOOLS: Record<string, readonly string[]> = {
  'dashboard-editor': EDITOR_TOOLS,
  'twin-editor': TWIN_TOOLS,
  'twin2d-editor': TWIN_2D_TOOLS,
  'dataset-table': TABLE_TOOLS,
}

/** 后端登记的全部客户端工具名。 */
function backendClientTools(): string[] {
  const found: string[] = []
  for (const file of SPEC_FILES) {
    const source = readFileSync(join(CHAT_DIR, 'services', file), 'utf8')
    for (const block of source.split('ToolSpec(').slice(1)) {
      const name = /name="([^"]+)"/.exec(block)?.[1]
      if (name !== undefined && block.includes('runs_on="client"')) {
        found.push(name)
      }
    }
  }
  return found
}

/** 一个 `字段=(…)` 元组里的那几个字符串字面量。 */
function tupleOf(source: string, field: string): string[] {
  const from = source.indexOf(`${field}=(`)
  if (from < 0) return []
  const to = source.indexOf(')', from)
  return [...source.slice(from, to).matchAll(/"([^"]+)"/g)].map(
    (match) => match[1] ?? '',
  )
}

interface SkillDecl {
  name: string
  surfaces: string[]
  clientTools: string[]
}

function skillDecls(): SkillDecl[] {
  const root = join(CHAT_DIR, 'skills')
  return (
    readdirSync(root, { withFileTypes: true })
      // ⚠ 按「有没有 manifest.py」筛，不是按目录名：跑过一次 pytest 之后
      // 这里还会多出一个 `__pycache__`，而那一天这条闸才第一次红
      .filter(
        (entry) =>
          entry.isDirectory() &&
          existsSync(join(root, entry.name, 'manifest.py')),
      )
      .map((entry) => {
        const source = readFileSync(
          join(root, entry.name, 'manifest.py'),
          'utf8',
        )
        return {
          name: tupleOf(source, 'name')[0] ?? entry.name,
          surfaces: tupleOf(source, 'surface_kinds'),
          clientTools: tupleOf(source, 'client_tools'),
        }
      })
  )
}

describe('客户端工具两侧同名', () => {
  it('确实读到了后端那几份规格（读不到就等于这条闸没跑）', () => {
    expect(backendClientTools().length).toBeGreaterThan(10)
    expect(skillDecls().length).toBeGreaterThan(3)
  })

  it('页面自报的每一个工具，后端都有一份规格', () => {
    const declared = new Set(backendClientTools())
    const ghosts = Object.entries(SURFACE_TOOLS).flatMap(([kind, tools]) =>
      tools
        .filter((tool) => !declared.has(tool))
        .map((tool) => `${kind}:${tool}`),
    )
    expect(ghosts).toEqual([])
  })

  it('后端每一份规格，至少有一个页面实现了它', () => {
    // ⚠ 内建那一批不归任何一页（`user.ask` 由回合驱动自己执行），单独放行
    const builtin = new Set(BUILTIN_CLIENT_TOOLS)
    const implemented = new Set(Object.values(SURFACE_TOOLS).flat())
    const orphans = backendClientTools().filter(
      (tool) => !implemented.has(tool) && !builtin.has(tool),
    )
    expect(orphans).toEqual([])
  })

  it('内建的那一批确实在规格里，且不归任何工作面', () => {
    const declared = new Set(backendClientTools())
    expect(declared.has(ASSISTANT_ASK_TOOL)).toBe(true)
    const implemented = new Set(Object.values(SURFACE_TOOLS).flat())
    expect(implemented.has(ASSISTANT_ASK_TOOL)).toBe(false)
  })

  it('技能声明的工具，它每个工作面都实现了', () => {
    const missing = skillDecls().flatMap((skill) =>
      skill.surfaces.flatMap((kind) => {
        const tools = new Set(SURFACE_TOOLS[kind] ?? [])
        return skill.clientTools
          .filter((tool) => !tools.has(tool))
          .map((tool) => `${skill.name}@${kind}:${tool}`)
      }),
    )
    expect(missing).toEqual([])
  })
})
