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