/**
 * learning API — 错题本 / 复习队列 / 掌握度 / 模考
 */
import api from './client'

export interface MasteryItem {
  kp_name: string
  subject: string | null
  level: number
  label: string
  color: string
  correct_count: number
  wrong_count: number
  streak: number
  accuracy: number | null
  next_review_at: string | null
  due: boolean
  first_wrong_at: string | null
}

export interface MistakeItem {
  id: number
  code: string
  subject: string | null
  title: string
  content: string | null
  my_answer: string | null
  correct_answer: string | null
  cause: string | null
  cause_label: string
  knowledge_tags: string[]
  difficulty: number
  mastered: boolean
  review_count: number
  next_review_at: string | null
  last_reviewed_at: string | null
  due: boolean
  created_at: string | null
}

export interface ReviewQueue {
  due_mistakes: MistakeItem[]
  weak_points: MasteryItem[]
  counts: {
    due_mistakes: number
    weak_points: number
    mastered_mistakes: number
    total_mistakes: number
  }
  generated_at: string
}

export interface Flashcard {
  id: string
  name: string
  subject: string
  stage: string
  aliases: string[]
  summary: string | null
  formula: string | null
  pitfalls: string[]
  exam_points: string[]
  difficulty: number
  practiced: boolean
  mastery: number | null
  mastery_label: string
  wrong_count: number
  due: boolean
}

export interface MasteryUpdate {
  kp_name: string
  level: number
  label: string
  next_review_at: string
  reason: string
}

export interface ExamItem {
  id: number
  name: string
  subject: string | null
  exam_date: string | null
  score: number | null
  total: number | null
  rate: number | null
  rank: number | null
  detail: any[]
  note: string | null
}

export const learningStats = (user_id = 1) =>
  api.get('/learning/stats', { params: { user_id } }).then(r => r.data)

export const reviewQueue = (limit = 20, user_id = 1) =>
  api.get<ReviewQueue>('/review/queue', { params: { limit, user_id } }).then(r => r.data)

export const flashcards = (params?: { subject?: string; limit?: number; user_id?: number }) =>
  api.get<{ items: Flashcard[]; count: number; practiced_count: number; total_count: number; subjects: string[] }>(
    '/review/flashcards', { params }
  ).then(r => r.data)

export const listMistakes = (params?: {
  subject?: string
  only_due?: boolean
  only_unmastered?: boolean
  limit?: number
  user_id?: number
}) =>
  api.get<{ items: MistakeItem[]; count: number }>('/mistakes', { params }).then(r => r.data)

export const createMistake = (data: {
  subject: string
  title: string
  content?: string
  my_answer?: string
  correct_answer?: string
  cause?: string
  knowledge_tags?: string[]
  difficulty?: number
  user_id?: number
}) => api.post<{ success: boolean; id: number; code: string; mastery_updates: MasteryUpdate[] }>(
  '/mistakes', data
).then(r => r.data)

export const reviewMistake = (id: number, answered_correct: boolean, note = '', user_id = 1) =>
  api.post<{ success: boolean; mistake: MistakeItem; mastery_updates: MasteryUpdate[]; review_count: number }>(
    `/mistakes/${id}/review`, { answered_correct, note, user_id }
  ).then(r => r.data)

export const deleteMistake = (id: number, user_id = 1) =>
  api.delete(`/mistakes/${id}`, { params: { user_id } }).then(r => r.data)

export const listMastery = (params?: { subject?: string; user_id?: number }) =>
  api.get<{ items: MasteryItem[]; count: number }>('/mastery', { params }).then(r => r.data)

export const weakPoints = (params?: { subject?: string; limit?: number; user_id?: number }) =>
  api.get<{ items: MasteryItem[]; count: number }>('/mastery/weak', { params }).then(r => r.data)

export const listExams = (params?: { subject?: string; limit?: number; user_id?: number }) =>
  api.get<{ items: ExamItem[]; count: number }>('/exams', { params }).then(r => r.data)

export const examTrend = (params?: { subject?: string; user_id?: number }) =>
  api.get<{ exams: ExamItem[]; trend: any[]; top_lost: any[]; count: number }>(
    '/exams/trend', { params }
  ).then(r => r.data)

export const createExam = (data: {
  name: string
  subject: string
  score: number
  total?: number
  exam_date?: string
  rank?: number
  detail?: any[]
  note?: string
  user_id?: number
}) => api.post<{ success: boolean; id: number; mastery_updates: MasteryUpdate[] }>(
  '/exams', data
).then(r => r.data)
