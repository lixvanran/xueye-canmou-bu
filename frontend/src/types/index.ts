// Type definitions

export type Scenario = 'volunteer' | 'exam' | 'chat' | 'chitchat'

export type EducationStage =
  | 'primary' | 'middle' | 'high' | 'vocational'
  | 'junior_college' | 'bachelor' | 'master' | 'abroad'
  | 'working' | 'other'

export type ResourceType = 'mistake' | 'material'

export interface Message {
  id?: number
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  tool_calls?: any
  rag_used?: {
    user_resources?: Array<{ code: string; title: string; type: string; score: number; has_file?: boolean }>
    kb_results?: Array<{ title: string; type: string; score: number }>
  }
  // v0.1: RAG 全过程 trace
  rag_trace?: {
    query: string
    started_at: number
    finished_at?: number
    latency_ms?: number
    stages: Array<{
      stage: string
      timestamp_ms: number
      input_summary: string
      output_summary: string
      data: any
    }>
    summary: any
  }
  search_results?: Array<{
    tool: string
    args: any
    result: any
  }>
  reasoning?: string
  route?: {
    complexity: 'low' | 'medium' | 'high'
    model: string
    tier_description?: string
    reason?: string
  }
  created_at?: string
}

export interface Conversation {
  id: number
  user_id: number
  scenario: Scenario
  title: string
  created_at: string
  updated_at: string
}

export interface ConversationWithMessages extends Conversation {
  messages: Message[]
}

export interface UserProfile {
  id: number
  name: string
  education_stage: EducationStage
  province?: string | null
  score?: number | null
  rank?: number | null
  target?: string | null
  interests?: string | null
  background?: string | null
  // v2.0: profile 扩展字段 (由 backend-architecture 任务同步添加)
  stage?: string | null
  direction?: string | null
  language?: string | null
  agent_name?: string | null
  // v2.0: 精简版前端表单字段 (mistakes-knowledge-graph 任务添加)
  subject_choice?: string  // 选科 (如 "物化生")
  target_school?: string   // 目标院校
  target_major?: string    // 目标专业
  interest?: string        // 兴趣方向 (替代老 interests)
  notes?: string           // 备注 (替代老 background)
}

export interface EducationStageOption {
  value: EducationStage
  label: string
  icon: string
}

// Unified resource (replaces old WrongQuestion and Material)
export interface Resource {
  id: number
  type: ResourceType
  code?: string | null
  title: string
  content?: string | null
  file_path?: string | null
  subject?: string | null
  tags: string[]
  knowledge_point?: string | null
  // v2.0: 知识图谱
  knowledge_tags?: string[]
  difficulty?: number  // 1-5
  error_type?: string | null
  mastered: boolean
  notes?: string | null
  solution?: string | null
  thinking?: string | null
  created_at: string
  updated_at?: string
}

// v2.0: 错题薄弱点
export interface WeakTopic {
  tag: string
  weight: number
  mistake_count: number
  unmastered_count: number
  difficulty_avg: number | null
}
export interface WeakTopicsResponse {
  user_id: number
  total_mistakes: number
  unmastered_count: number
  top_k: number
  weak_topics: WeakTopic[]
  all_topics?: WeakTopic[]
}

// v2.0: User profile view
export interface ProfileViewResponse {
  user_id: number
  raw_profile: Record<string, any>
  derived_rules: string[]
  preview_prompt: string
}
