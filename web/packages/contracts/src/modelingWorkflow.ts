/** @fileoverview 工作流定时训练与训练后发布契约。 */
export interface ModelingSchedule {
  pipeline_id: string
  is_enabled: boolean
  interval_minutes: number
  auto_publish: boolean
  next_run_at: string | null
  last_run_at: string | null
  last_run_id: string | null
  last_error: string | null
  revision: number
  updated_at: string | null
}

export interface ModelingScheduleInput {
  is_enabled: boolean
  interval_minutes: number
  auto_publish: boolean
  first_run_at?: string | null
  expected_revision: number
}

export type ModelingPublicationStatus =
  'not_requested' | 'pending' | 'published' | 'failed' | 'skipped'
