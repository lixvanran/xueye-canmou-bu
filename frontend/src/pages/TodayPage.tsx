/**
 * TodayPage - v0.1.7 真实内容版
 *
 * "今日" 主页: 整合今日日程 / 待办错题 / 最近对话 / 学习趋势
 * 所有卡片都是真实数据, 不再有"建设中"占位
 */
import { useEffect, useState } from 'react'
import { Sparkles, Calendar, BookOpen, MessageCircle, TrendingUp, ArrowRight, Clock, Target } from 'lucide-react'
import { listSchedule, listResources, listConversations, getProfileStats, getLearningTimeline } from '../api'

interface ScheduleItem {
  id: number
  date: string
  content: string
  type: string
  completed: boolean
}
interface ResourceItem {
  id: number
  title: string
  subject?: string
  mastered: boolean
  created_at?: string
}
interface ConversationItem {
  id: number
  title: string
  scenario: string
  updated_at?: string
}
interface ProfileStats {
  total_mistakes: number
  mastered: number
  mastered_rate: number
  conversation_count: number
  message_count: number
  by_subject: Record<string, number>
}
interface TimelineItem {
  date: string
  mistakes_added: number
  schedules_done: number
  messages: number
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function TodayPage({ onNavigate }: { onNavigate?: (page: string) => void } = {}) {
  const [schedules, setSchedules] = useState<ScheduleItem[]>([])
  const [mistakes, setMistakes] = useState<ResourceItem[]>([])
  const [recentConvs, setRecentConvs] = useState<ConversationItem[]>([])
  const [stats, setStats] = useState<ProfileStats | null>(null)
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      listSchedule({ start_date: todayStr(), end_date: todayStr(), include_completed: false, limit: 10 }).catch(() => ({ items: [] })),
      listResources({ type: 'mistake', mastered: false, limit: 5 } as any).catch(() => ({ items: [] })),
      listConversations(5).catch(() => ({ items: [] })),
      getProfileStats().catch(() => null),
      getLearningTimeline(7).catch(() => ({ days: 7, items: [] })),
    ]).then(([s, m, c, st, tl]: any) => {
      setSchedules(s.items || [])
      setMistakes(m.items || [])
      setRecentConvs((c.items || []).slice(0, 5))
      setStats(st)
      setTimeline((tl.items || []).slice(-7).reverse())
      setLoading(false)
    })
  }, [])

  const today = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto">
        {/* Hero */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-white shadow-md">
              <Sparkles size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-zinc-800">今日 · {today}</h1>
              <p className="text-sm text-zinc-500 mt-0.5">
                一眼看完今天的安排、错题、对话和学情
              </p>
            </div>
          </div>
        </div>

        {/* 4 张数据卡 — 真实数据 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard
            icon={<Calendar size={16} className="text-blue-500" />}
            label="今日待办"
            value={schedules.length}
            unit="项"
            color="blue"
          />
          <StatCard
            icon={<Target size={16} className="text-orange-500" />}
            label="未掌握错题"
            value={mistakes.length}
            unit="道"
            color="orange"
          />
          <StatCard
            icon={<BookOpen size={16} className="text-emerald-500" />}
            label="掌握率"
            value={stats ? Math.round((stats.mastered_rate || 0) * 100) : 0}
            unit="%"
            color="emerald"
          />
          <StatCard
            icon={<MessageCircle size={16} className="text-violet-500" />}
            label="总对话"
            value={stats?.conversation_count || 0}
            unit="轮"
            color="violet"
          />
        </div>

        {/* 今日日程 */}
        <SectionCard
          icon={<Calendar size={18} className="text-blue-500" />}
          title="今日日程"
          count={schedules.length}
          navTo="schedule"
          onNavigate={onNavigate}
          empty="今天没有待办, 休息一下或去资料库逛逛"
        >
          {schedules.length > 0 && (
            <ul className="space-y-2">
              {schedules.slice(0, 5).map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-3 py-2 bg-blue-50/50 rounded-xl text-sm">
                  <Clock size={14} className="text-blue-400 flex-shrink-0" />
                  <span className="flex-1 text-zinc-700">{s.content}</span>
                  <span className="text-xs text-blue-500 px-2 py-0.5 bg-blue-100 rounded-full">
                    {s.type || 'study'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* 待办错题 */}
        <SectionCard
          icon={<BookOpen size={18} className="text-orange-500" />}
          title="待复习错题"
          count={mistakes.length}
          navTo="resources"
          onNavigate={onNavigate}
          empty="没有未掌握的错题, 真棒!"
        >
          {mistakes.length > 0 && (
            <ul className="space-y-2">
              {mistakes.slice(0, 5).map((m) => (
                <li key={m.id} className="flex items-center gap-3 px-3 py-2 bg-orange-50/50 rounded-xl text-sm">
                  <span className="text-xs font-mono text-orange-600 bg-orange-100 px-2 py-0.5 rounded">
                    M-{String(m.id).padStart(3, '0')}
                  </span>
                  <span className="flex-1 text-zinc-700 truncate">{m.title}</span>
                  {m.subject && (
                    <span className="text-xs text-zinc-500">{m.subject}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* 最近对话 */}
        <SectionCard
          icon={<MessageCircle size={18} className="text-violet-500" />}
          title="最近对话"
          count={recentConvs.length}
          navTo="chat"
          onNavigate={onNavigate}
          empty="还没有对话, 进'会话'开始聊聊"
        >
          {recentConvs.length > 0 && (
            <ul className="space-y-2">
              {recentConvs.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-3 py-2 bg-violet-50/50 rounded-xl text-sm">
                  <span className="text-xs px-2 py-0.5 bg-violet-100 text-violet-600 rounded">
                    {c.scenario === 'chat' ? '答疑' : c.scenario === 'exam' ? '考试' : c.scenario === 'volunteer' ? '志愿' : c.scenario === 'chitchat' ? '闲聊' : c.scenario}
                  </span>
                  <span className="flex-1 text-zinc-700 truncate">{c.title}</span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        {/* 本周学习趋势 (7 天 mini bar) */}
        <SectionCard
          icon={<TrendingUp size={18} className="text-rose-500" />}
          title="本周学习"
          count={timeline.filter(t => t.messages > 0 || t.mistakes_added > 0).length}
        >
          {timeline.length > 0 ? (
            <div className="flex items-end gap-1 h-24">
              {timeline.map((d) => {
                const max = Math.max(...timeline.flatMap(x => [x.messages, x.mistakes_added]), 1)
                return (
                  <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5">
                    <div className="flex items-end gap-0.5 w-full justify-center" style={{ height: '85%' }}>
                      <div
                        className="w-3 bg-red-400 rounded-t"
                        style={{ height: `${(d.mistakes_added / max) * 100}%`, minHeight: d.mistakes_added > 0 ? '2px' : '0' }}
                        title={`${d.date} 错题+${d.mistakes_added}`}
                      />
                      <div
                        className="w-3 bg-blue-400 rounded-t"
                        style={{ height: `${(d.messages / max) * 100}%`, minHeight: d.messages > 0 ? '2px' : '0' }}
                        title={`${d.date} 消息+${d.messages}`}
                      />
                    </div>
                    <div className="text-[10px] text-zinc-400">{d.date.slice(5)}</div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="text-sm text-zinc-500">最近 7 天暂无学习数据</div>
          )}
          <div className="flex items-center gap-3 mt-3 text-xs text-zinc-500 justify-center">
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-red-400 rounded" />错题</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 bg-blue-400 rounded" />消息</span>
          </div>
        </SectionCard>

        {loading && (
          <div className="text-center text-xs text-zinc-400 mt-4">加载中...</div>
        )}
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, unit, color }: { icon: React.ReactNode; label: string; value: number; unit: string; color: string }) {
  const bgMap: Record<string, string> = {
    blue: 'bg-blue-50 border-blue-200',
    orange: 'bg-orange-50 border-orange-200',
    emerald: 'bg-emerald-50 border-emerald-200',
    violet: 'bg-violet-50 border-violet-200',
  }
  return (
    <div className={`${bgMap[color] || 'bg-white'} border rounded-2xl p-3 shadow-sm`}>
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-xs text-zinc-500">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold text-zinc-800">{value}</span>
        <span className="text-xs text-zinc-500">{unit}</span>
      </div>
    </div>
  )
}

function SectionCard({
  icon, title, count, navTo, onNavigate, empty, children,
}: {
  icon: React.ReactNode; title: string; count: number;
  navTo?: string; onNavigate?: (page: string) => void;
  empty?: string; children?: React.ReactNode
}) {
  return (
    <div className="mb-4 bg-white/70 backdrop-blur border border-black/5 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="font-semibold text-zinc-800">{title}</h2>
          {count > 0 && (
            <span className="text-xs px-2 py-0.5 bg-zinc-100 text-zinc-500 rounded-full">{count}</span>
          )}
        </div>
        {navTo && onNavigate && (
          <button
            onClick={() => onNavigate(navTo)}
            className="text-xs text-zinc-500 hover:text-zinc-800 flex items-center gap-1"
          >
            查看全部 <ArrowRight size={12} />
          </button>
        )}
      </div>
      {children || (empty && <div className="text-sm text-zinc-400 py-4 text-center">{empty}</div>)}
    </div>
  )
}