/**
 * schedule API — 共享封装
 */
import api from './client'

export interface ScheduleItem {
  id: number
  date: string
  content: string
  type: string
  completed: boolean
  note?: string | null
  resource_id?: number | null
}

export const listSchedule = (params?: {
  start_date?: string
  end_date?: string
  type?: string
  include_completed?: boolean
  user_id?: number
  limit?: number
}) =>
  api.get<{ total: number; items: ScheduleItem[] }>('/schedule/list', { params }).then(r => r.data)

export const createSchedule = (data: Partial<ScheduleItem>) =>
  api.post<{ success: boolean; id: number }>('/schedule/create', data).then(r => r.data)

export const toggleSchedule = (id: number, completed?: boolean, user_id: number = 1) =>
  api.post<{ success: boolean; completed: boolean; toggled?: boolean }>('/schedule/toggle',
    completed === undefined ? { id, user_id } : { id, user_id, completed }
  ).then(r => r.data)

export const deleteSchedule = (id: number, user_id: number = 1) =>
  api.post<{ success: boolean }>('/schedule/delete', { id, user_id }).then(r => r.data)