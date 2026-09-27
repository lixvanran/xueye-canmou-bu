/** 用户 API */
import api from './client'
import type { UserProfile, EducationStageOption, ProfileViewResponse } from '@/types'

export const getUserProfile = () =>
  api.get<UserProfile>('/user/profile').then(r => r.data)

/** v2.0: 更新 profile, 用 body (PUT) 而不是 query string, 适配新字段
 * 老字段 (education_stage/province/score/rank/target/interests/background)
 * 仍兼容 — 后端 update_profile 都接受
 */
export const updateUserProfile = (data: Partial<UserProfile> & Record<string, any>) =>
  api.put('/user/profile', data).then(r => r.data)

export const getEducationStages = () =>
  api.get<{ stages: EducationStageOption[] }>('/user/education-stages').then(r => r.data.stages)

/** v2.0: "AI 怎么理解我" — 给前端折叠区显示 build_system_prompt 实际看到的 profile 块 */
export const getProfileView = () =>
  api.get<ProfileViewResponse>('/user/profile-view').then(r => r.data)

// v0.1.7: 学情统计 + 学习轨迹 + 人格
export const getProfileStats = () =>
  api.get<{
    user_id: number
    total_mistakes: number
    mastered: number
    mastered_rate: number
    by_subject: Record<string, number>
    by_difficulty: Record<string, number>
    top_knowledge_tags: Array<{ tag: string; count: number }>
    conversation_count: number
    message_count: number
  }>('/user/profile-stats').then(r => r.data)

export const getLearningTimeline = (days = 30) =>
  api.get<{ days: number; items: Array<{ date: string; mistakes_added: number; schedules_done: number; messages: number }> }>(`/user/learning-timeline?days=${days}`).then(r => r.data)

export const getPersonas = () =>
  api.get<{ personas: Array<{ value: string; label: string; desc: string; scenario_fit: string[] }> }>('/user/personas').then(r => r.data.personas)

export const getPersona = () =>
  api.get<{ persona: string }>('/user/persona').then(r => r.data.persona)

export const setPersona = (persona: string) =>
  api.post<{ message: string; persona: string; persona_label: string }>('/user/persona', { persona }).then(r => r.data)