/**
 * @fileoverview 角色表单要办的那件事：新建（可带一组种子码）与编辑两态。
 *
 * 克隆不是第三态，它就是 `mode: 'create'` 且三个字段非空——判别式落在类型里，
 * 表单内部因此不必为克隆多长一条分支。
 */

import type { RoleSummary } from '@dt/contracts'

export type RoleFormTask =
  | {
      mode: 'create'
      name: string
      description: string
      codes: readonly string[]
      /** 码集来自哪个角色。只影响一句提示，不参与任何分支判定。 */
      seededFrom?: string
    }
  | { mode: 'edit'; role: RoleSummary }
