/**
 * ChatPage - v2.0 重做
 *
 * 顶部 3 个 tab (答疑 / 报志愿 / 随便聊聊), 切换 tab 时:
 *  - 清空 in-memory message buffer (不带上下文)
 *  - 当前 tab 状态持久到 localStorage ('chat_active_tab')
 *  - 每个 tab 独立 conversation_id (本地状态占位)
 *
 * "随便聊聊" tab 加人格下拉, 选中调用 POST /api/agent/persona (后端本期返回 501)
 */
import { useState, useEffect, useRef } from 'react'
import { MessageSquare, GraduationCap, MessageCircle, ChevronDown, Loader2, AlertCircle, CheckCircle2, UserCircle2, BookOpen, Target, X, Sparkles } from 'lucide-react'
import api from '@/api/client'
import { listResources } from '@/api/resources'
import { getWeakTopics } from '@/api/workspace'
import type { Resource, WeakTopic, WeakTopicsResponse } from '@/types'

type ChatTab = 'qa' | 'volunteer' | 'chitchat'

const TAB_STORAGE_KEY = 'chat_active_tab'
const CONV_STORAGE_KEY = 'chat_conversation_ids' // { qa: number|null, volunteer: number|null, chitchat: number|null }

interface TabConfig {
  key: ChatTab
  label: string
  icon: any
  color: string
  bg: string
  description: string
}

const TABS: TabConfig[] = [
  {
    key: 'qa',
    label: '答疑',
    icon: GraduationCap,
    color: 'text-blue-700',
    bg: 'bg-blue-50 border-blue-200',
    description: '题目讲解、知识点梳理、解题思路 — Agent 帮你拆解每一步',
  },
  {
    key: 'volunteer',
    label: '报志愿',
    icon: MessageSquare,
    color: 'text-emerald-700',
    bg: 'bg-emerald-50 border-emerald-200',
    description: '根据分数 / 位次 / 兴趣, 推荐院校与专业组合方案',
  },
  {
    key: 'chitchat',
    label: '随便聊聊',
    icon: MessageCircle,
    color: 'text-violet-700',
    bg: 'bg-violet-50 border-violet-200',
    description: '非正式对话, 选个人格陪你聊 — 切换人格需重新选择',
  },
]

const PERSONAS: Array<{ value: string; label: string; desc: string }> = [
  { value: 'teacher_zhang', label: '张老师', desc: '严厉直接, 一针见血 (默认)' },
  { value: 'senior_sister', label: '学姐', desc: '温和耐心, 经验分享' },
  { value: 'humor_master', label: '段子手', desc: '轻松幽默, 化解压力' },
]

const DEFAULT_TAB: ChatTab = 'qa'

function loadActiveTab(): ChatTab {
  try {
    const v = localStorage.getItem(TAB_STORAGE_KEY) as ChatTab | null
    if (v && TABS.some(t => t.key === v)) return v
  } catch {
    // ignore
  }
  return DEFAULT_TAB
}

function loadConvIds(): Record<ChatTab, number | null> {
  const base: Record<ChatTab, number | null> = { qa: null, volunteer: null, chitchat: null }
  try {
    const raw = localStorage.getItem(CONV_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      for (const k of Object.keys(base) as ChatTab[]) {
        if (parsed && typeof parsed[k] === 'number') base[k] = parsed[k]
      }
    }
  } catch {
    // ignore
  }
  return base
}

function saveConvIds(ids: Record<ChatTab, number | null>) {
  try {
    localStorage.setItem(CONV_STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // ignore
  }
}

export default function ChatPage() {
  const [activeTab, setActiveTab] = useState<ChatTab>(() => loadActiveTab())
  const [convIds, setConvIds] = useState<Record<ChatTab, number | null>>(() => loadConvIds())
  // 单 in-memory message buffer: 切换 tab 时清空, 不带上下文
  const [messages, setMessages] = useState<any[]>([])
  const [input, setInput] = useState('')

  // persona 状态 (仅 chitchat 有效)
  const [persona, setPersona] = useState<string>('teacher_zhang')
  const [personaLoading, setPersonaLoading] = useState(false)
  const [personaMsg, setPersonaMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [personaOpen, setPersonaOpen] = useState(false)
  const personaMenuRef = useRef<HTMLDivElement>(null)

  // v2.0: 错题本选题 (答疑 tab 用)
  const [mistakePickerOpen, setMistakePickerOpen] = useState(false)
  const [mistakeList, setMistakeList] = useState<Resource[]>([])
  const [mistakeLoading, setMistakeLoading] = useState(false)
  const [mistakeError, setMistakeError] = useState<string | null>(null)

  // v2.0: 薄弱点分析 (答疑 tab 用)
  const [weakTopicsOpen, setWeakTopicsOpen] = useState(false)
  const [weakTopics, setWeakTopics] = useState<WeakTopicsResponse | null>(null)
  const [weakTopicsLoading, setWeakTopicsLoading] = useState(false)

  // 持久化 active tab
  useEffect(() => {
    try {
      localStorage.setItem(TAB_STORAGE_KEY, activeTab)
    } catch {
      // ignore
    }
  }, [activeTab])

  // 持久化 conv ids
  useEffect(() => {
    saveConvIds(convIds)
  }, [convIds])

  // persona 下拉点击外部关闭
  useEffect(() => {
    if (!personaOpen) return
    const onDoc = (e: MouseEvent) => {
      if (personaMenuRef.current && !personaMenuRef.current.contains(e.target as Node)) {
        setPersonaOpen(false)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [personaOpen])

  const switchTab = (next: ChatTab) => {
    if (next === activeTab) return
    // 切换 tab: 清空 in-memory message buffer, 不带上下文
    setMessages([])
    setInput('')
    setActiveTab(next)
    setPersonaMsg(null)
  }

  const handlePersonaChange = async (next: string) => {
    setPersonaOpen(false)
    setPersona(next)
    setPersonaLoading(true)
    setPersonaMsg(null)
    try {
      // 后端本期返回 501, 这里捕获 501 弹提示
      await api.post('/agent/persona', { persona: next })
      setPersonaMsg({ type: 'ok', text: `已切换人格: ${PERSONAS.find(p => p.value === next)?.label || next}` })
    } catch (e: any) {
      const status = e?.response?.status
      const detail = e?.response?.data?.detail || e?.message || '请求失败'
      if (status === 501) {
        setPersonaMsg({ type: 'err', text: `切换失败 (501 Not Implemented): 该端点将在后续版本实现` })
      } else {
        setPersonaMsg({ type: 'err', text: `切换失败: ${detail}` })
      }
    } finally {
      setPersonaLoading(false)
    }
  }

  // v2.0: 打开错题选择面板, 拉最近 20 道错题
  const openMistakePicker = async () => {
    setMistakePickerOpen(true)
    setMistakeError(null)
    setMistakeLoading(true)
    try {
      const r = await listResources({ type: 'mistake' })
      // 排序: 未掌握优先, 然后按时间倒序, 取前 20
      const items = [...(r.items || [])]
        .sort((a, b) => {
          if (a.mastered !== b.mastered) return a.mastered ? 1 : -1
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        })
        .slice(0, 20)
      setMistakeList(items)
    } catch (e: any) {
      setMistakeError(e?.message || '加载错题失败')
    } finally {
      setMistakeLoading(false)
    }
  }

  // v2.0: 选中一道错题 → 把它作为消息导入当前会话
  const pickMistake = (r: Resource) => {
    const tags = r.knowledge_tags?.length ? `\n[知识点]: ${r.knowledge_tags.join(', ')}` : ''
    const kp = r.knowledge_point ? `\n[大知识点]: ${r.knowledge_point}` : ''
    const subject = r.subject ? `[${r.subject}] ` : ''
    const code = r.code ? `看 ${r.code}: ` : ''
    const msg = `请帮我讲一下这道错题:\n\n${code}${subject}${r.title}${kp}\n\n题目:\n${r.content || '(无内容)'}${tags}\n\n请先识别这道题的考点, 再讲清思路。`
    setInput(msg)
    setMistakePickerOpen(false)
  }

  // v2.0: 打开薄弱点分析面板
  const openWeakTopics = async () => {
    setWeakTopicsOpen(true)
    setWeakTopics(null)
    setWeakTopicsLoading(true)
    try {
      const data = await getWeakTopics(1, 5)
      setWeakTopics(data)
    } catch (e: any) {
      // 失败时显示一个轻量错误, 不弹 alert
      setWeakTopics({
        user_id: 1,
        total_mistakes: 0,
        unmastered_count: 0,
        top_k: 5,
        weak_topics: [],
      })
    } finally {
      setWeakTopicsLoading(false)
    }
  }

  // v2.0: 把薄弱点喂给 Agent (让 Agent 出复习建议)
  const sendWeakTopicsToAgent = () => {
    if (!weakTopics || !weakTopics.weak_topics.length) return
    const topics = weakTopics.weak_topics.map(t => t.tag).join('、')
    const msg = `我的薄弱知识点 (按出错次数+未掌握排序, top 5):\n${weakTopics.weak_topics.map((t, i) =>
      `${i + 1}. ${t.tag} (错${t.mistake_count}次, 未掌握${t.unmastered_count}次${t.difficulty_avg ? `, 难度均${t.difficulty_avg}/5` : ''})`
    ).join('\n')}\n\n请针对这些薄弱点给我一份具体的复习建议: 1) 每点该练什么 2) 练到什么程度算过关 3) 推荐的学习顺序。`
    setInput(msg)
    setWeakTopicsOpen(false)
  }

  const tabConfig = TABS.find(t => t.key === activeTab) || TABS[0]
  const currentConvId = convIds[activeTab]

  return (
    <div className="flex flex-col h-full bg-gradient-to-b from-zinc-50 to-white">
      {/* 顶部 tab bar */}
      <div className="border-b border-black/5 bg-white/60 backdrop-blur-xl">
        <div className="flex items-center px-6">
          {TABS.map((t) => {
            const Icon = t.icon
            const isActive = activeTab === t.key
            return (
              <button
                key={t.key}
                onClick={() => switchTab(t.key)}
                className={`relative px-5 py-3.5 text-sm font-medium flex items-center gap-2 transition-colors ${
                  isActive
                    ? `${t.color}`
                    : 'text-zinc-500 hover:text-zinc-800'
                }`}
              >
                <Icon size={15} />
                {t.label}
                {isActive && (
                  <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-current rounded-t-full" />
                )}
              </button>
            )
          })}
          <div className="ml-auto text-xs text-zinc-400">
            v2.0 · 切换 tab 不带上下文
          </div>
        </div>
      </div>

      {/* 主区 */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-3xl mx-auto">
          {/* 当前 tab 描述 */}
          <div className={`rounded-2xl border p-5 mb-5 ${tabConfig.bg}`}>
            <div className="flex items-center gap-2 mb-1">
              <tabConfig.icon size={18} className={tabConfig.color} />
              <h2 className={`font-bold ${tabConfig.color}`}>{tabConfig.label}</h2>
            </div>
            <p className="text-sm text-zinc-600">{tabConfig.description}</p>
            {currentConvId != null && (
              <div className="mt-2 text-xs text-zinc-400">
                会话 ID: #{currentConvId}
              </div>
            )}
          </div>

          {/* v2.0: 答疑 tab 专属快捷按钮 — 从错题本选题 + 分析薄弱点 */}
          {activeTab === 'qa' && (
            <div className="mb-4 grid grid-cols-2 gap-3">
              <button
                onClick={openMistakePicker}
                className="flex items-center gap-3 px-4 py-3 bg-white border border-blue-200 rounded-2xl text-sm hover:border-blue-400 hover:bg-blue-50 transition-all shadow-sm"
              >
                <BookOpen size={18} className="text-blue-600 flex-shrink-0" />
                <div className="text-left">
                  <div className="font-semibold text-gray-800">从错题本选题</div>
                  <div className="text-xs text-gray-500">选一道错题让 Agent 讲</div>
                </div>
              </button>
              <button
                onClick={openWeakTopics}
                className="flex items-center gap-3 px-4 py-3 bg-white border border-orange-200 rounded-2xl text-sm hover:border-orange-400 hover:bg-orange-50 transition-all shadow-sm"
              >
                <Target size={18} className="text-orange-600 flex-shrink-0" />
                <div className="text-left">
                  <div className="font-semibold text-gray-800">分析薄弱点</div>
                  <div className="text-xs text-gray-500">Top 5 知识盲点</div>
                </div>
              </button>
            </div>
          )}

          {/* v2.0: 错题选择面板 */}
          {mistakePickerOpen && (
            <div className="mb-4 bg-white border border-blue-200 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <BookOpen size={16} className="text-blue-600" />
                  <span className="text-sm font-semibold text-gray-700">从错题本选题</span>
                  <span className="text-xs text-gray-400">(未掌握优先)</span>
                </div>
                <button
                  onClick={() => setMistakePickerOpen(false)}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <X size={14} />
                </button>
              </div>
              {mistakeLoading ? (
                <div className="text-center py-6 text-gray-400">
                  <Loader2 size={20} className="animate-spin mx-auto mb-1" />
                  <div className="text-xs">加载中...</div>
                </div>
              ) : mistakeError ? (
                <div className="text-sm text-red-600 py-3">{mistakeError}</div>
              ) : mistakeList.length === 0 ? (
                <div className="text-center py-6 text-gray-400 text-sm">
                  错题本是空的, 先去资料库添加几道
                </div>
              ) : (
                <div className="space-y-1.5 max-h-72 overflow-y-auto">
                  {mistakeList.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => pickMistake(r)}
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-blue-50 transition-colors border border-transparent hover:border-blue-200"
                    >
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        {r.code && (
                          <span className="px-1.5 py-0.5 bg-gray-800 text-white text-xs font-mono rounded">
                            {r.code}
                          </span>
                        )}
                        {r.subject && (
                          <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
                            {r.subject}
                          </span>
                        )}
                        {r.mastered && (
                          <span className="px-1.5 py-0.5 bg-green-100 text-green-700 text-xs rounded">已掌握</span>
                        )}
                        {r.knowledge_tags?.slice(0, 2).map(t => (
                          <span key={t} className="px-1.5 py-0.5 bg-cyan-100 text-cyan-700 text-xs rounded">#{t}</span>
                        ))}
                      </div>
                      <div className="text-sm text-gray-800 line-clamp-1">{r.title}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* v2.0: 薄弱点面板 */}
          {weakTopicsOpen && (
            <div className="mb-4 bg-gradient-to-br from-orange-50 to-red-50 border border-orange-200 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Target size={16} className="text-orange-600" />
                  <span className="text-sm font-semibold text-gray-700">薄弱点分析</span>
                  {weakTopics && (
                    <span className="text-xs text-gray-500">
                      ({weakTopics.total_mistakes} 道错题, 未掌握 {weakTopics.unmastered_count})
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setWeakTopicsOpen(false)}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  <X size={14} />
                </button>
              </div>
              {weakTopicsLoading ? (
                <div className="text-center py-6 text-gray-400">
                  <Loader2 size={20} className="animate-spin mx-auto mb-1" />
                  <div className="text-xs">分析中...</div>
                </div>
              ) : !weakTopics || weakTopics.weak_topics.length === 0 ? (
                <div className="text-center py-6 text-gray-400 text-sm">
                  错题本数据不足, 还没有"薄弱点"
                </div>
              ) : (
                <>
                  <div className="space-y-1.5 mb-3">
                    {weakTopics.weak_topics.map((t, i) => (
                      <div
                        key={t.tag}
                        className="flex items-center gap-3 px-3 py-2 bg-white/70 rounded-lg border border-orange-100"
                      >
                        <span className="w-6 h-6 rounded-full bg-orange-500 text-white text-xs flex items-center justify-center font-bold flex-shrink-0">
                          {i + 1}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-800">{t.tag}</div>
                          <div className="text-xs text-gray-500">
                            错 {t.mistake_count} 次 · 未掌握 {t.unmastered_count}
                            {t.difficulty_avg != null && ` · 难度 ${t.difficulty_avg}/5`}
                          </div>
                        </div>
                        <div className="text-xs text-orange-600 font-mono">
                          权重 {t.weight}
                        </div>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={sendWeakTopicsToAgent}
                    className="w-full py-2 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600 flex items-center justify-center gap-2"
                  >
                    <Sparkles size={14} />
                    让 Agent 给出复习计划
                  </button>
                </>
              )}
            </div>
          )}

          {/* chitchat tab 才显示人格下拉 */}
          {activeTab === 'chitchat' && (
            <div className="mb-5 bg-white/70 backdrop-blur border border-black/5 rounded-2xl p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <UserCircle2 size={16} className="text-violet-500" />
                <span className="text-sm font-semibold text-zinc-700">人格</span>
                <span className="text-xs text-zinc-400">(切换人格本期返回 501, 仅 UI 演示)</span>
              </div>
              <div className="relative" ref={personaMenuRef}>
                <button
                  onClick={() => setPersonaOpen(o => !o)}
                  disabled={personaLoading}
                  className="w-full flex items-center justify-between px-3 py-2 bg-white border border-black/10 rounded-xl text-sm hover:border-violet-300 transition-colors disabled:opacity-50"
                >
                  <span>
                    {PERSONAS.find(p => p.value === persona)?.label || persona}
                    <span className="ml-2 text-xs text-zinc-400">
                      {PERSONAS.find(p => p.value === persona)?.desc}
                    </span>
                  </span>
                  {personaLoading ? (
                    <Loader2 size={14} className="animate-spin text-violet-500" />
                  ) : (
                    <ChevronDown size={14} className="text-zinc-400" />
                  )}
                </button>
                {personaOpen && (
                  <div className="absolute z-10 mt-1 w-full bg-white border border-black/10 rounded-xl shadow-lg overflow-hidden">
                    {PERSONAS.map(p => (
                      <button
                        key={p.value}
                        onClick={() => handlePersonaChange(p.value)}
                        disabled={personaLoading}
                        className={`w-full flex flex-col items-start px-3 py-2 text-left text-sm hover:bg-violet-50 transition-colors disabled:opacity-50 ${
                          persona === p.value ? 'bg-violet-50' : ''
                        }`}
                      >
                        <span className="font-medium text-zinc-800">{p.label}</span>
                        <span className="text-xs text-zinc-500">{p.desc}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {personaMsg && (
                <div
                  className={`mt-3 flex items-start gap-2 text-sm rounded-lg p-3 border ${
                    personaMsg.type === 'ok'
                      ? 'bg-green-50 border-green-200 text-green-800'
                      : 'bg-red-50 border-red-200 text-red-800'
                  }`}
                >
                  {personaMsg.type === 'ok' ? (
                    <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  )}
                  <span>{personaMsg.text}</span>
                </div>
              )}
            </div>
          )}

          {/* 占位 / 简单消息展示 */}
          <div className="bg-white/70 backdrop-blur border border-black/5 rounded-2xl p-5 shadow-sm min-h-[200px]">
            {messages.length === 0 ? (
              <div className="text-center text-zinc-400 py-10">
                <tabConfig.icon size={36} className="mx-auto mb-3 text-zinc-300" />
                <div className="text-sm">开始和 {tabConfig.label} 助手对话</div>
                <div className="text-xs mt-1">由其他任务填充完整对话 UI</div>
              </div>
            ) : (
              <div className="space-y-2 text-sm text-zinc-700">
                {messages.map((m, i) => (
                  <div key={i} className="text-zinc-600">{String(m.content ?? '')}</div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 text-center text-xs text-zinc-400">
            由其他任务填充 (流式回答 / 知识图谱联动 / 历史搜索)
          </div>
        </div>
      </div>

      {/* 输入区 (简化) */}
      <div className="border-t border-black/5 bg-white/60 backdrop-blur-xl p-4">
        <div className="max-w-3xl mx-auto flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`输入消息 (当前 tab: ${tabConfig.label})`}
            className="flex-1 px-3 py-2 bg-white border border-black/10 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-300"
            rows={2}
          />
          <button
            disabled={!input.trim()}
            className="px-4 py-2 bg-zinc-900 text-white text-sm rounded-full disabled:opacity-30 disabled:cursor-not-allowed"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  )
}