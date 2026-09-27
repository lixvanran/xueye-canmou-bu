/**
 * ChatPage - v2.0 重做
 *
 * 顶部 3 个 tab (答疑 / 报志愿 / 随便聊聊), 切换 tab 时:
 *  - 清空 in-memory message buffer (不带上下文)
 *  - 当前 tab 状态持久到 localStorage ('chat_active_tab')
 *  - 每个 tab 独立 conversation_id (本地状态占位)
 *
 * "随便聊聊" tab 加人格下拉, 选中调用 POST /api/agent/persona (后端本期返回 501)
 *
 * v2.0 增量:
 *  - 顶部历史会话搜索框 + scenario 过滤 chip
 *  - 答疑 tab 加 "帮我安排学习计划" quick action (触发 chat message 走 schedule 工具)
 */
import { useState, useEffect, useRef } from 'react'
import {
  MessageSquare, GraduationCap, MessageCircle, ChevronDown, Loader2, AlertCircle, CheckCircle2,
  UserCircle2, BookOpen, Target, X, Sparkles, Search, Calendar, Clock, ArrowRight,
  Cpu, Brain, Wrench, Database, Network, Activity, GitBranch, ChevronRight as ChevronRightSm,
} from 'lucide-react'
import api from '@/api/client'
import { listResources } from '@/api/resources'
import { getWeakTopics } from '@/api/workspace'
import { getConversation } from '@/api/conversations'
import { streamChat } from '@/api/chat'
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

// v2.0: scenario label 映射 (search 结果用)
const SCENARIO_LABEL: Record<string, string> = {
  chat: '答疑',
  exam: '答疑(学习)',
  volunteer: '报志愿',
  chitchat: '随便聊聊',
}

function formatTime(iso?: string | null): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const now = new Date()
    const diff = (now.getTime() - d.getTime()) / 1000
    if (diff < 60) return '刚刚'
    if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`
    if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`
    return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  } catch {
    return iso
  }
}

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
  // v0.1.6: 发送状态 (补回被删的 send 按钮功能)
  const [sending, setSending] = useState(false)
  const [abortCtrl, setAbortCtrl] = useState<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  // v0.1.7: 当前正在流的 trace (assistant 消息接收 event 时累积)
  const [currentTrace, setCurrentTrace] = useState<any>(null)
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

  // v2.0: 历史会话搜索
  const [searchQ, setSearchQ] = useState('')
  const [searchScenario, setSearchScenario] = useState<'' | 'all' | 'chat' | 'exam' | 'volunteer' | 'chitchat'>('all')
  const [searchResults, setSearchResults] = useState<Array<{
    id: number; title: string; scenario: string; updated_at: string; hit_count?: number
  }>>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchErr, setSearchErr] = useState<string | null>(null)
  const [openingConvId, setOpeningConvId] = useState<number | null>(null)
  const [openConvMsg, setOpenConvMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // v2.0: 安排学习计划 quick action 提示
  const [scheduleActionMsg, setScheduleActionMsg] = useState<{ type: 'ok' | 'info'; text: string } | null>(null)

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

  // v2.0: 历史会话搜索 (debounce 300ms)
  useEffect(() => {
    if (!searchOpen) return
    setSearchErr(null)
    const timer = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const params = new URLSearchParams()
        params.set('q', searchQ.trim())
        params.set('limit', '20')
        params.set('user_id', '1')
        if (searchScenario && searchScenario !== 'all') {
          params.set('scenario', searchScenario)
        }
        const r = await fetch(`/api/conversations/search?${params.toString()}`)
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = await r.json()
        setSearchResults(Array.isArray(data.items) ? data.items : [])
      } catch (e: any) {
        setSearchErr(e?.message || '搜索失败')
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQ, searchScenario, searchOpen])

  // v2.0: 打开某个历史会话
  const handleOpenConversation = async (convId: number, scenario: string) => {
    setOpeningConvId(convId)
    setOpenConvMsg(null)
    try {
      const data = await getConversation(convId)
      // 把消息塞到当前 in-memory buffer
      setMessages(data.messages || [])
      setSearchOpen(false)
      setSearchQ('')
      // 切到对应 tab (用场景映射)
      const mapped: Record<string, ChatTab> = {
        chat: 'qa',
        exam: 'qa',
        volunteer: 'volunteer',
        chitchat: 'chitchat',
      }
      const targetTab = mapped[scenario] || 'qa'
      if (targetTab !== activeTab) {
        switchTab(targetTab)
      }
      setConvIds(prev => ({ ...prev, [targetTab]: convId }))
      setOpenConvMsg({ type: 'ok', text: `已打开会话 #${convId}: ${data.title || '(无标题)'}` })
      setTimeout(() => setOpenConvMsg(null), 2500)
    } catch (e: any) {
      setOpenConvMsg({ type: 'err', text: `打开失败: ${e?.message || '?'}` })
    } finally {
      setOpeningConvId(null)
    }
  }

  // v2.0: 安排学习计划 quick action
  const handleScheduleQuickAction = () => {
    const goal = '请帮我安排下周 (从今天起 7 天) 的数学复习计划, 每天 1 个任务, 兼顾错题巩固 + 新知识预习。完成后调用 schedule 工具把计划写进我的日程, 不要只口头说说。'
    setInput(goal)
    setScheduleActionMsg({
      type: 'info',
      text: '提示: Agent 在对话中会自动调用 schedule 工具生成日程, 完成后可到「日程」页查看。'
    })
    setTimeout(() => setScheduleActionMsg(null), 5000)
  }

  const switchTab = (next: ChatTab) => {
    if (next === activeTab) return
    // 切换 tab: 清空 in-memory message buffer, 不带上下文
    setMessages([])
    setInput('')
    setActiveTab(next)
    setPersonaMsg(null)
    // v0.1.7 修复 [P1] 下属报告: 切 tab 时清 trace, 否则切回原 tab 看到陈旧 trace 卡片
    setCurrentTrace({
      started: false,
      steps: [],
      llm_done: false,
      tool_calls_count: 0,
      total_latency_ms: 0,
      model_used: '',
    })
    // 同时 abort in-flight stream (如有)
    if (abortCtrl) {
      try { abortCtrl.abort() } catch {}
      setAbortCtrl(null)
    }
  }

  // v0.1.6: 发送消息 — 调 /api/chat 流式响应, 渲染到消息列表
  const tabToScenario: Record<ChatTab, 'chat' | 'exam' | 'volunteer' | 'chitchat'> = {
    qa: 'chat',
    volunteer: 'volunteer',
    chitchat: 'chitchat',
  }

  const handleSend = async () => {
    const text = input.trim()
    if (!text || sending) return

    const scenario = tabToScenario[activeTab] || 'chat'
    const ctrl = new AbortController()
    setAbortCtrl(ctrl)
    setSending(true)

    // 1. 立即塞 user message
    const userMsg = { role: 'user', content: text, created_at: new Date().toISOString() }
    const assistantMsg = {
      role: 'assistant',
      content: '',
      streaming: true,
      created_at: new Date().toISOString(),
      trace: null, // v0.1.7: Agent 完整运行过程 (route/rag/tools/thinking)
    }
    setMessages((prev) => [...prev, userMsg, assistantMsg])
    setInput('')
    const emptyTrace = {
      start: null as any, ctx: null as any, route: null as any, rag: null as any, rag_trace: null as any,
      tool_calls: [] as any[], tool_results: [] as any[], thinking: '', reasoning: null as any,
      llm_done: null as any, end: null as any,
    }
    setCurrentTrace({ ...emptyTrace })

    try {
      let acc = ''
      const trace: typeof emptyTrace = {
        ...emptyTrace,
        tool_calls: [],
        tool_results: [],
      }
      const updateTrace = () => setCurrentTrace({ ...trace })
      const commitTraceToMsg = () => {
        // 流结束后把 trace 塞回消息对象
        setMessages((prev) => {
          const next = [...prev]
          const idx = next.length - 1
          if (idx >= 0 && next[idx].role === 'assistant') {
            next[idx] = { ...next[idx], trace: { ...trace } }
          }
          return next
        })
      }

      for await (const ev of streamChat(
        {
          message: text,
          scenario,
          conversation_id: currentConvId ?? undefined,
          user_id: 1,
          stream: true,
        },
        ctrl.signal,
      )) {
        switch (ev.type) {
          case 'start':
            trace.start = ev.data
            updateTrace()
            break
          case 'ctx':
            trace.ctx = ev.data
            updateTrace()
            break
          case 'rag':
            trace.rag = ev.data
            updateTrace()
            break
          case 'rag_trace':
            trace.rag_trace = ev.data
            updateTrace()
            break
          case 'route':
            trace.route = ev.data
            updateTrace()
            break
          case 'tools':
            // v0.1.7: 后端 ev.data 是 {raw: [{name, args}, ...]} 或单对象, 展开成多条
            if (ev.data && Array.isArray((ev.data as any).raw)) {
              trace.tool_calls = trace.tool_calls.concat((ev.data as any).raw)
            } else if (ev.data && Array.isArray(ev.data)) {
              trace.tool_calls = trace.tool_calls.concat(ev.data as any)
            } else {
              trace.tool_calls = trace.tool_calls.concat([ev.data])
            }
            updateTrace()
            break
          case 'search_results':
            // 同上 — 后端可能是 {raw: [...]} 或单对象
            if (ev.data && Array.isArray((ev.data as any).raw)) {
              trace.tool_results = trace.tool_results.concat((ev.data as any).raw)
            } else if (ev.data && Array.isArray(ev.data)) {
              trace.tool_results = trace.tool_results.concat(ev.data as any)
            } else {
              trace.tool_results = trace.tool_results.concat([ev.data])
            }
            updateTrace()
            break
          case 'thinking':
            trace.thinking += String(ev.data || '')
            updateTrace()
            break
          case 'reasoning':
            trace.reasoning = ev.data
            updateTrace()
            break
          case 'llm_done':
            trace.llm_done = ev.data
            updateTrace()
            break
          case 'end':
            trace.end = ev.data
            updateTrace()
            break
          case 'content':
            acc += String(ev.data || '')
            // 更新最后一条 assistant 消息
            setMessages((prev) => {
              const next = [...prev]
              const idx = next.length - 1
              if (idx >= 0 && next[idx].role === 'assistant') {
                next[idx] = { ...next[idx], content: acc, streaming: true }
              }
              return next
            })
            break
          case 'stopped':
            setMessages((prev) => {
              const next = [...prev]
              const idx = next.length - 1
              if (idx >= 0 && next[idx].role === 'assistant') {
                next[idx] = { ...next[idx], content: acc + '\n\n[已停止]', streaming: false }
              }
              return next
            })
            break
        }
      }
      // 流结束 — 标记 streaming=false + trace 入消息
      commitTraceToMsg()
      setCurrentTrace(null)
    } catch (e: any) {
      const isAbort = e?.name === 'AbortError' || ctrl.signal.aborted
      setMessages((prev) => {
        const next = [...prev]
        const idx = next.length - 1
        if (idx >= 0 && next[idx].role === 'assistant') {
          next[idx] = {
            ...next[idx],
            content: next[idx].content + (isAbort ? '\n\n[已停止]' : '\n\n[出错: ' + (e?.message || '?') + ']'),
            streaming: false,
          }
        }
        return next
      })
    } finally {
      setSending(false)
      setAbortCtrl(null)
      // 滚到底
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    }
  }

  const handleAbort = () => {
    abortCtrl?.abort()
  }

  const handlePersonaChange = async (next: string) => {
    setPersonaOpen(false)
    setPersona(next)
    setPersonaLoading(true)
    setPersonaMsg(null)
    try {
      // v0.1.7: 端点真接上了 (后端 POST /api/user/persona)
      await api.post('/user/persona', { persona: next })
      setPersonaMsg({ type: 'ok', text: `已切换人格: ${PERSONAS.find(p => p.value === next)?.label || next} (下次对话生效)` })
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
      <div className="border-b border-black/5 bg-white/60 backdrop-blur-xl relative">
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

          {/* v2.0: 历史会话搜索框 (右侧) */}
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQ}
                onChange={(e) => {
                  setSearchQ(e.target.value)
                  setSearchOpen(true)
                }}
                onFocus={() => setSearchOpen(true)}
                placeholder="搜索历史会话..."
                className="pl-8 pr-3 py-1.5 bg-white border border-black/10 rounded-full text-xs w-56 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:w-72 transition-all"
              />
              {searchOpen && (
                <button
                  onClick={() => {
                    setSearchOpen(false)
                    searchInputRef.current?.blur()
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-300 hover:text-zinc-500"
                  title="关闭"
                >
                  <X size={12} />
                </button>
              )}
            </div>
            <div className="text-xs text-zinc-400 hidden sm:block">
              v2.0 · 切换 tab 不带上下文
            </div>
          </div>
        </div>

        {/* v2.0: 搜索结果下拉 */}
        {searchOpen && (
          <div className="absolute right-6 mt-1 bg-white border border-black/10 rounded-2xl shadow-xl z-30 w-[28rem] max-w-[calc(100vw-3rem)] overflow-hidden">
            {/* scenario chip 过滤 */}
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-black/5 bg-zinc-50/60 flex-wrap">
              <span className="text-xs text-zinc-500">场景:</span>
              {[
                { v: 'all',       l: '全部' },
                { v: 'chat',      l: '答疑' },
                { v: 'exam',      l: '答疑(学习)' },
                { v: 'volunteer', l: '报志愿' },
                { v: 'chitchat',  l: '随便聊聊' },
              ].map(c => (
                <button
                  key={c.v}
                  onClick={() => setSearchScenario(c.v as any)}
                  className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                    searchScenario === c.v
                      ? 'bg-zinc-900 text-white border-zinc-900'
                      : 'bg-white border-black/10 text-zinc-600 hover:bg-zinc-50'
                  }`}
                >
                  {c.l}
                </button>
              ))}
            </div>

            {/* 结果 */}
            <div className="max-h-80 overflow-y-auto">
              {searchLoading ? (
                <div className="px-4 py-6 text-center text-zinc-400 text-sm">
                  <Loader2 size={18} className="animate-spin inline mr-1" />
                  搜索中...
                </div>
              ) : searchErr ? (
                <div className="px-4 py-4 text-sm text-red-600 flex items-start gap-2">
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                  <div>搜索失败: {searchErr}</div>
                </div>
              ) : searchResults.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <Search size={28} className="mx-auto text-zinc-200 mb-2" />
                  <div className="text-sm text-zinc-500">
                    {searchQ.trim() ? '没有匹配的会话' : '输入关键词搜索历史会话'}
                  </div>
                  <div className="text-xs text-zinc-400 mt-1">
                    匹配标题 + 消息内容 (LIKE %q%)
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-black/5">
                  {searchResults.map(r => (
                    <button
                      key={r.id}
                      onClick={() => handleOpenConversation(r.id, r.scenario)}
                      disabled={openingConvId === r.id}
                      className="w-full text-left px-4 py-2.5 hover:bg-violet-50 transition-colors flex items-center gap-3 disabled:opacity-50"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-zinc-800 truncate">
                          {r.title || `(无标题 #${r.id})`}
                        </div>
                        <div className="text-xs text-zinc-500 mt-0.5 flex items-center gap-2 flex-wrap">
                          <span className="px-1.5 py-0.5 bg-zinc-100 rounded text-zinc-600">
                            {SCENARIO_LABEL[r.scenario] || r.scenario}
                          </span>
                          <span className="inline-flex items-center gap-0.5">
                            <Clock size={10} />
                            {formatTime(r.updated_at)}
                          </span>
                          {r.hit_count != null && (
                            <span className="text-violet-600">
                              命中 {r.hit_count} 条
                            </span>
                          )}
                          <span className="text-zinc-400">#{r.id}</span>
                        </div>
                      </div>
                      {openingConvId === r.id ? (
                        <Loader2 size={14} className="animate-spin text-violet-500" />
                      ) : (
                        <ArrowRight size={14} className="text-zinc-400" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* v2.0: 打开历史会话的 toast 提示 (在主区内显示) */}
      {openConvMsg && (
        <div className="px-6 pt-2">
          <div className={`max-w-3xl mx-auto rounded-xl px-3 py-2 text-xs border flex items-center gap-2 ${
            openConvMsg.type === 'ok'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}>
            {openConvMsg.type === 'ok' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
            <span>{openConvMsg.text}</span>
          </div>
        </div>
      )}

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

          {/* v2.0: 答疑 tab 专属快捷按钮 — 从错题本选题 + 分析薄弱点 + 安排学习计划 */}
          {activeTab === 'qa' && (
            <>
              <div className="mb-4 grid grid-cols-3 gap-3">
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
                <button
                  onClick={handleScheduleQuickAction}
                  className="flex items-center gap-3 px-4 py-3 bg-white border border-emerald-200 rounded-2xl text-sm hover:border-emerald-400 hover:bg-emerald-50 transition-all shadow-sm"
                >
                  <Calendar size={18} className="text-emerald-600 flex-shrink-0" />
                  <div className="text-left">
                    <div className="font-semibold text-gray-800">帮我安排学习计划</div>
                    <div className="text-xs text-gray-500">Agent 自动写日程</div>
                  </div>
                </button>
              </div>
              {scheduleActionMsg && (
                <div className={`mb-4 rounded-xl px-3 py-2 text-xs border flex items-start gap-2 ${
                  scheduleActionMsg.type === 'ok'
                    ? 'bg-green-50 border-green-200 text-green-800'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-800'
                }`}>
                  <Sparkles size={13} className="flex-shrink-0 mt-0.5" />
                  <span>{scheduleActionMsg.text}</span>
                </div>
              )}
            </>
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

          {/* 消息列表 — v0.1.6 渲染 user/assistant 区分 + 流式光标 */}
          <div className="bg-white/70 backdrop-blur border border-black/5 rounded-2xl p-5 shadow-sm min-h-[200px] max-h-[calc(100vh-280px)] overflow-y-auto">
            {messages.length === 0 ? (
              <div className="text-center text-zinc-400 py-10">
                <tabConfig.icon size={36} className="mx-auto mb-3 text-zinc-300" />
                <div className="text-sm">开始和 {tabConfig.label} 助手对话</div>
                <div className="text-xs mt-1">输入消息后按 Enter 或点「发送」</div>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((m, i) => {
                  const isUser = m.role === 'user'
                  const isLast = i === messages.length - 1
                  return (
                    <div
                      key={i}
                      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words ${
                          isUser
                            ? 'bg-zinc-900 text-white rounded-br-sm'
                            : 'bg-zinc-100 text-zinc-900 rounded-bl-sm'
                        }`}
                      >
                        {m.content || (m.streaming ? '' : '(空)')}
                        {m.streaming && (
                          <span className="inline-block w-1.5 h-4 bg-violet-400 ml-1 align-middle animate-pulse" />
                        )}
                      </div>
                      {isLast && <div ref={messagesEndRef} />}
                      {/* v0.1.7: Agent 完整运行过程可视化 — 每个 assistant 消息下挂一个折叠面板 */}
                      {!isUser && (m.trace || m.streaming) && (
                        <AgentTracePanel
                          trace={m.trace}
                          liveTrace={m.streaming && isLast ? currentTrace : null}
                        />
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="mt-3 text-center text-xs text-zinc-400">
            流式响应 · 自动滚动 · Shift+Enter 换行
          </div>
        </div>
      </div>

      {/* 输入区 (简化) */}
      <div className="border-t border-black/5 bg-white/60 backdrop-blur-xl p-4">
        <div className="max-w-3xl mx-auto flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // v0.1.6: Enter 发送, Shift+Enter 换行
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder={`输入消息 (当前 tab: ${tabConfig.label}, Enter 发送, Shift+Enter 换行)`}
            className="flex-1 px-3 py-2 bg-white border border-black/10 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-300"
            rows={2}
            disabled={sending}
          />
          {sending ? (
            <button
              onClick={handleAbort}
              className="px-4 py-2 bg-red-500 text-white text-sm rounded-full hover:bg-red-600 flex items-center gap-1"
            >
              停止
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="px-4 py-2 bg-zinc-900 text-white text-sm rounded-full disabled:opacity-30 disabled:cursor-not-allowed"
            >
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ===== v0.1.7: Agent 完整运行过程可视化面板 (参赛核心展示) =====
function AgentTracePanel({ trace, liveTrace }: { trace: any; liveTrace: any }) {
  const t = liveTrace || trace || {}
  const [expanded, setExpanded] = useState(false)
  const [expandedStep, setExpandedStep] = useState<string | null>(null)

  const total = t?.end?.total_latency_ms
  const isLive = !!liveTrace

  // 阶段数据
  const steps: Array<{
    key: string; icon: any; label: string; color: string; data?: any; sub?: string
  }> = [
    {
      key: 'start',
      icon: Activity,
      label: '启动',
      color: 'bg-slate-100 text-slate-700',
      data: t.start,
      sub: t.start?.scenario ? `scenario: ${t.start.scenario}` : undefined,
    },
    {
      key: 'ctx',
      icon: Database,
      label: '上下文',
      color: 'bg-blue-100 text-blue-700',
      data: t.ctx,
      sub: t.ctx ? `${t.ctx.history_count || 0} 历史 + ${t.ctx.facts_count || 0} 事实 + ${t.ctx.user_resources_count || 0} 错题` : undefined,
    },
    {
      key: 'rag',
      icon: BookOpen,
      label: 'RAG 检索',
      color: 'bg-purple-100 text-purple-700',
      data: t.rag,
      sub: t.rag ? `命中: ${(t.rag.kb_results || []).length} KB / ${(t.rag.user_resources || []).length} 错题` : undefined,
    },
    {
      key: 'rag_trace',
      icon: GitBranch,
      label: 'RAG 步骤',
      color: 'bg-purple-50 text-purple-600',
      data: t.rag_trace,
      sub: t.rag_trace?.stages ? `${t.rag_trace.stages.length} 步 · ${t.rag_trace.summary?.latency_ms ?? '?'}ms` : undefined,
    },
    {
      key: 'route',
      icon: Cpu,
      label: '分级路由',
      color: 'bg-amber-100 text-amber-700',
      data: t.route,
      sub: t.route ? `${t.route.complexity} → ${t.route.model}` : undefined,
    },
    {
      key: 'tools',
      icon: Wrench,
      label: '工具调用',
      color: 'bg-emerald-100 text-emerald-700',
      data: { calls: t.tool_calls || [], results: t.tool_results || [] },
      sub: `${(t.tool_calls || []).length} 次调用${(t.tool_calls || []).length > 0 ? ' / ' + ((t.tool_calls || []).map((c: any) => c.name).filter((v: any, i: number, a: string[]) => a.indexOf(v) === i).join(', ')) : ''}`,
    },
    {
      key: 'thinking',
      icon: Brain,
      label: '思考过程',
      color: 'bg-indigo-100 text-indigo-700',
      data: t.thinking,
      sub: t.thinking ? `${t.thinking.length} 字` : (t.reasoning?.thinking ? `${t.reasoning.thinking.length} 字 (deep)` : undefined),
    },
    {
      key: 'llm_done',
      icon: Sparkles,
      label: 'LLM 完成',
      color: 'bg-green-100 text-green-700',
      data: t.llm_done,
      sub: t.llm_done ? `${t.llm_done.latency_ms}ms · 输出 ${t.llm_done.content_length} 字` : undefined,
    },
  ]

  // 没数据且没在 live, 不显示
  if (!isLive && !total && !t.start) return null

  return (
    <div className="w-full mt-2 ml-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
          isLive
            ? 'bg-violet-50 border-violet-300 text-violet-700 animate-pulse'
            : 'bg-white border-zinc-200 text-zinc-700 hover:border-zinc-400'
        }`}
        title="Agent 完整运行过程 (分级路由 · RAG 检索 · 工具调用 · 思考过程)"
      >
        <Search size={12} />
        <span>{isLive ? 'Agent 运行中...' : '🔍 Agent 完整运行过程'}</span>
        {total != null && <span className="text-zinc-500">· {(total / 1000).toFixed(2)}s</span>}
        {expanded ? <ChevronDown size={12} /> : <ChevronRightSm size={12} />}
      </button>

      {expanded && (
        <div className="mt-2 bg-white border border-zinc-200 rounded-xl p-3 text-xs space-y-2 shadow-sm">
          {/* 时间线 */}
          <div className="flex flex-wrap gap-2">
            {steps.map((s) => {
              const Icon = s.icon
              const hasData = s.data !== null && s.data !== undefined && s.data !== ''
              const isOpen = expandedStep === s.key
              return (
                <div key={s.key} className="flex-1 min-w-[120px]">
                  <button
                    onClick={() => setExpandedStep(isOpen ? null : s.key)}
                    disabled={!hasData}
                    className={`w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md border ${
                      hasData
                        ? 'bg-white border-zinc-200 hover:border-zinc-400 cursor-pointer'
                        : 'bg-zinc-50 border-zinc-100 text-zinc-400 cursor-default'
                    }`}
                  >
                    <span className={`inline-flex items-center justify-center w-5 h-5 rounded ${s.color}`}>
                      <Icon size={10} />
                    </span>
                    <span className="font-medium text-zinc-700">{s.label}</span>
                    {s.sub && <span className="text-zinc-500 text-[10px] truncate">{s.sub}</span>}
                  </button>
                  {isOpen && hasData && (
                    <pre className="mt-1 p-2 bg-zinc-50 rounded text-[10px] overflow-auto max-h-48 text-zinc-700 border border-zinc-100">
                      {JSON.stringify(s.data, null, 2)}
                    </pre>
                  )}
                </div>
              )
            })}
          </div>

          {/* 总览 */}
          {t.end && (
            <div className="pt-2 border-t border-zinc-100 flex flex-wrap gap-3 text-zinc-600">
              <span><Clock size={10} className="inline mr-1" />总耗时 <b>{(t.end.total_latency_ms / 1000).toFixed(2)}s</b></span>
              <span><Cpu size={10} className="inline mr-1" />模型 <b>{t.end.model_used}</b></span>
              <span><Database size={10} className="inline mr-1" />上下文 <b>{t.end.ctx_latency_ms}ms</b></span>
              <span><Network size={10} className="inline mr-1" />路由 <b>{t.end.route_latency_ms}ms</b></span>
              <span><Sparkles size={10} className="inline mr-1" />LLM <b>{t.end.llm_latency_ms}ms</b></span>
              <span><Wrench size={10} className="inline mr-1" />工具 <b>{t.end.tool_calls_count} 次</b></span>
              {t.end.reasoning_length > 0 && (
                <span><Brain size={10} className="inline mr-1" />思考 <b>{t.end.reasoning_length} 字</b></span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}