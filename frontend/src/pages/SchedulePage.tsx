/**
 * SchedulePage - v2.0
 *
 * 视图: 月历 / 列表 (toggle)
 * 月历: 点击日期 → 选中那天高亮 + 列表显示当天日程
 * 列表: 全部日程按日期分组, 支持筛选类型 / 完成状态
 * 操作: 新建 (modal) / 勾选完成 (toggle) / 删除 (带 confirm)
 * API (全部走 fetch):
 *   - GET    /api/schedule/list?start_date=&end_date=&type=&include_completed=
 *   - POST   /api/schedule/create     { date, content, type, note, user_id }
 *   - POST   /api/schedule/update     { id, date?, content?, type?, note?, completed?, user_id }
 *   - POST   /api/schedule/delete     { id, user_id }
 *   - POST   /api/schedule/toggle     { id, completed, user_id }   (便捷勾选)
 * 错误: 弹 toast (顶部条) 自动 3s 消失
 */
import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import {
  Calendar, Plus, List, CalendarDays, ChevronLeft, ChevronRight,
  CheckCircle2, Circle, Trash2, X, Loader2, AlertTriangle, Sparkles, BookOpen, ClipboardList,
} from 'lucide-react'

// ===== Types =====
type ScheduleType = 'study' | 'review' | 'exam' | 'rest' | 'custom'
type ScheduleItem = {
  id: number
  date: string         // YYYY-MM-DD
  content: string
  type: ScheduleType
  completed: boolean
  note?: string | null
  resource_id?: number | null
  created_at?: string
  updated_at?: string
}

type ViewMode = 'month' | 'list'

// ===== Constants =====
const TYPE_OPTIONS: Array<{ value: ScheduleType; label: string; color: string; bg: string }> = [
  { value: 'study',  label: '学习',  color: 'text-blue-700',   bg: 'bg-blue-50 border-blue-200' },
  { value: 'review', label: '复习',  color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
  { value: 'exam',   label: '考试',  color: 'text-red-700',    bg: 'bg-red-50 border-red-200' },
  { value: 'rest',   label: '休息',  color: 'text-violet-700', bg: 'bg-violet-50 border-violet-200' },
  { value: 'custom', label: '其他',  color: 'text-zinc-700',   bg: 'bg-zinc-100 border-zinc-200' },
]

const TYPE_LABEL: Record<ScheduleType, string> = {
  study: '学习', review: '复习', exam: '考试', rest: '休息', custom: '其他',
}
const TYPE_BADGE: Record<ScheduleType, string> = {
  study: 'bg-blue-100 text-blue-700',
  review: 'bg-emerald-100 text-emerald-700',
  exam: 'bg-red-100 text-red-700',
  rest: 'bg-violet-100 text-violet-700',
  custom: 'bg-zinc-200 text-zinc-700',
}

function todayISO(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function monthLabel(year: number, month: number): string {
  return `${year} 年 ${month + 1} 月`
}

function startOfMonthGrid(year: number, month: number): Date[] {
  // 返回 6 行 × 7 列 = 42 天的 Date[], 让月历固定大小
  const first = new Date(year, month, 1)
  const firstWeekday = first.getDay() // 0 = Sun
  const start = new Date(year, month, 1 - firstWeekday)
  const days: Date[] = []
  for (let i = 0; i < 42; i++) {
    days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  }
  return days
}

function dateISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function monthRange(year: number, month: number): { start: string; end: string } {
  // 用整月 (含前后 padding), 让月历里有标记的日子都能拿到
  const grid = startOfMonthGrid(year, month)
  return { start: dateISO(grid[0]), end: dateISO(grid[grid.length - 1]) }
}

// ===== Toast (简易) =====
type ToastMsg = { id: number; type: 'ok' | 'err' | 'info'; text: string }

function useToast() {
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  const idRef = useRef(1)
  const push = useCallback((type: ToastMsg['type'], text: string) => {
    const id = idRef.current++
    setToasts(t => [...t, { id, type, text }])
    setTimeout(() => {
      setToasts(t => t.filter(x => x.id !== id))
    }, 3000)
  }, [])
  return { toasts, push }
}

// ===== API (raw fetch) =====
async function fetchScheduleList(opts: {
  start_date?: string
  end_date?: string
  type?: ScheduleType | ''
  include_completed?: boolean
  user_id?: number
}): Promise<ScheduleItem[]> {
  const params = new URLSearchParams()
  if (opts.start_date) params.set('start_date', opts.start_date)
  if (opts.end_date) params.set('end_date', opts.end_date)
  if (opts.type) params.set('type', opts.type)
  if (opts.include_completed !== undefined) params.set('include_completed', String(opts.include_completed))
  params.set('user_id', String(opts.user_id ?? 1))
  params.set('limit', '200')
  const r = await fetch(`/api/schedule/list?${params.toString()}`)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const data = await r.json()
  return Array.isArray(data.items) ? data.items : []
}

async function createScheduleApi(body: {
  date: string
  content: string
  type: ScheduleType
  note?: string
  user_id?: number
}): Promise<ScheduleItem> {
  const r = await fetch('/api/schedule/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: 1, ...body }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const data = await r.json()
  if (!data.success) throw new Error(data.error || 'create failed')
  return data as ScheduleItem
}

async function updateScheduleApi(id: number, body: Partial<ScheduleItem>): Promise<ScheduleItem> {
  const r = await fetch('/api/schedule/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, user_id: 1, ...body }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const data = await r.json()
  if (!data.success) throw new Error(data.error || 'update failed')
  return data as ScheduleItem
}

async function deleteScheduleApi(id: number): Promise<void> {
  const r = await fetch('/api/schedule/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, user_id: 1 }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const data = await r.json()
  if (!data.success) throw new Error(data.error || 'delete failed')
}

async function toggleScheduleApi(id: number, completed: boolean): Promise<ScheduleItem> {
  const r = await fetch('/api/schedule/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, completed, user_id: 1 }),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const data = await r.json()
  if (!data.success) throw new Error(data.error || 'toggle failed')
  return data as ScheduleItem
}


// ===== Page =====
export default function SchedulePage() {
  const [view, setView] = useState<ViewMode>('month')
  const today = useMemo(() => new Date(), [])
  const [year, setYear] = useState<number>(today.getFullYear())
  const [month, setMonth] = useState<number>(today.getMonth())
  const [selectedDate, setSelectedDate] = useState<string>(todayISO())

  const [items, setItems] = useState<ScheduleItem[]>([])
  const [loading, setLoading] = useState(false)
  const [filterType, setFilterType] = useState<ScheduleType | ''>('')
  const [filterCompleted, setFilterCompleted] = useState<'all' | 'todo' | 'done'>('all')

  const [showCreate, setShowCreate] = useState(false)
  const [createDate, setCreateDate] = useState<string>(todayISO())
  const [createContent, setCreateContent] = useState('')
  const [createType, setCreateType] = useState<ScheduleType>('study')
  const [createNote, setCreateNote] = useState('')
  const [creating, setCreating] = useState(false)

  const { toasts, push } = useToast()

  // 加载当前视图范围
  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const { start, end } = view === 'month' ? monthRange(year, month) : { start: '1970-01-01', end: '2999-12-31' }
      const list = await fetchScheduleList({
        start_date: start,
        end_date: end,
        include_completed: filterCompleted !== 'todo',
      })
      setItems(list)
    } catch (e: any) {
      push('err', `加载日程失败: ${e?.message || '?'}`)
    } finally {
      setLoading(false)
    }
  }, [year, month, view, filterCompleted, push])

  useEffect(() => { reload() }, [reload])

  // 按日期分组 (key = YYYY-MM-DD)
  const grouped = useMemo(() => {
    const m = new Map<string, ScheduleItem[]>()
    for (const it of items) {
      if (!m.has(it.date)) m.set(it.date, [])
      m.get(it.date)!.push(it)
    }
    // 应用筛选
    const filtered = new Map<string, ScheduleItem[]>()
    for (const [date, list] of m.entries()) {
      let l = list
      if (filterType) l = l.filter(x => x.type === filterType)
      if (filterCompleted === 'todo') l = l.filter(x => !x.completed)
      if (filterCompleted === 'done') l = l.filter(x => x.completed)
      if (l.length > 0) filtered.set(date, l)
    }
    return filtered
  }, [items, filterType, filterCompleted])

  // 月历格子: 42 天
  const gridDays = useMemo(() => startOfMonthGrid(year, month), [year, month])

  // 选中日的列表
  const selectedList = useMemo(() => {
    const list = grouped.get(selectedDate) || []
    let l = list
    if (filterType) l = l.filter(x => x.type === filterType)
    if (filterCompleted === 'todo') l = l.filter(x => !x.completed)
    if (filterCompleted === 'done') l = l.filter(x => x.completed)
    return l
  }, [grouped, selectedDate, filterType, filterCompleted])

  // 月历里每天的计数
  const dayCount = useMemo(() => {
    const m = new Map<string, { total: number; done: number }>()
    for (const [date, list] of grouped.entries()) {
      const done = list.filter(x => x.completed).length
      m.set(date, { total: list.length, done })
    }
    return m
  }, [grouped])

  // ===== Actions =====
  const handlePrevMonth = () => {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  const handleNextMonth = () => {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }
  const handleToday = () => {
    const t = new Date()
    setYear(t.getFullYear())
    setMonth(t.getMonth())
    setSelectedDate(todayISO())
  }

  const handleCreate = async () => {
    if (!createContent.trim()) {
      push('err', '请填写内容')
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(createDate)) {
      push('err', '日期格式不对 (应为 YYYY-MM-DD)')
      return
    }
    setCreating(true)
    try {
      const created = await createScheduleApi({
        date: createDate,
        content: createContent.trim(),
        type: createType,
        note: createNote.trim() || undefined,
      })
      setItems(prev => [...prev, created].sort((a, b) => a.date.localeCompare(b.date)))
      push('ok', `已新建: ${created.content}`)
      setShowCreate(false)
      setCreateContent('')
      setCreateNote('')
      // 切到那一天
      setSelectedDate(created.date)
    } catch (e: any) {
      push('err', `新建失败: ${e?.message || '?'}`)
    } finally {
      setCreating(false)
    }
  }

  const handleToggle = async (item: ScheduleItem) => {
    // 乐观更新
    const next = !item.completed
    setItems(prev => prev.map(x => x.id === item.id ? { ...x, completed: next } : x))
    try {
      await toggleScheduleApi(item.id, next)
    } catch (e: any) {
      // 回滚
      setItems(prev => prev.map(x => x.id === item.id ? { ...x, completed: !next } : x))
      push('err', `更新失败: ${e?.message || '?'}`)
    }
  }

  const handleDelete = async (item: ScheduleItem) => {
    if (!confirm(`确定删除这条日程?\n\n${item.date} · ${TYPE_LABEL[item.type] || item.type}\n${item.content}`)) return
    // 乐观删除
    setItems(prev => prev.filter(x => x.id !== item.id))
    try {
      await deleteScheduleApi(item.id)
      push('ok', '已删除')
    } catch (e: any) {
      // 回滚
      setItems(prev => [...prev, item].sort((a, b) => a.date.localeCompare(b.date)))
      push('err', `删除失败: ${e?.message || '?'}`)
    }
  }

  const openCreateFor = (date: string) => {
    setCreateDate(date)
    setCreateContent('')
    setCreateNote('')
    setCreateType('study')
    setShowCreate(true)
  }

  // ===== Render =====
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white shadow-md">
              <Calendar size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-zinc-800">日程</h1>
              <p className="text-sm text-zinc-500 mt-0.5">
                学习计划 / 复习 / 考试 / 休息 — 自己安排或让 Agent 帮你排
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => openCreateFor(selectedDate || todayISO())}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-zinc-900 text-white text-sm rounded-full hover:bg-zinc-700"
            >
              <Plus size={14} />
              新建
            </button>
          </div>
        </div>

        {/* View toggle + month nav */}
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <div className="flex gap-2">
            <button
              onClick={() => setView('month')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition-colors ${
                view === 'month'
                  ? 'bg-zinc-900 text-white border-zinc-900'
                  : 'bg-white border-black/5 text-zinc-700 hover:bg-zinc-50'
              }`}
            >
              <CalendarDays size={12} />
              月历
            </button>
            <button
              onClick={() => setView('list')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition-colors ${
                view === 'list'
                  ? 'bg-zinc-900 text-white border-zinc-900'
                  : 'bg-white border-black/5 text-zinc-700 hover:bg-zinc-50'
              }`}
            >
              <List size={12} />
              列表
            </button>
          </div>

          {view === 'month' && (
            <div className="flex items-center gap-2">
              <button
                onClick={handlePrevMonth}
                className="p-1.5 bg-white border border-black/5 rounded-full hover:bg-zinc-50"
                title="上个月"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={handleToday}
                className="px-3 py-1 text-xs bg-white border border-black/5 rounded-full hover:bg-zinc-50 text-zinc-700"
                title="回到今天"
              >
                今天
              </button>
              <button
                onClick={handleNextMonth}
                className="p-1.5 bg-white border border-black/5 rounded-full hover:bg-zinc-50"
                title="下个月"
              >
                <ChevronRight size={14} />
              </button>
              <div className="ml-1 text-sm font-semibold text-zinc-700">
                {monthLabel(year, month)}
              </div>
            </div>
          )}
        </div>

        {/* Filter chips */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-xs text-zinc-500">类型:</span>
          <button
            onClick={() => setFilterType('')}
            className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
              filterType === ''
                ? 'bg-zinc-900 text-white border-zinc-900'
                : 'bg-white border-black/5 text-zinc-700 hover:bg-zinc-50'
            }`}
          >
            全部
          </button>
          {TYPE_OPTIONS.map(t => (
            <button
              key={t.value}
              onClick={() => setFilterType(filterType === t.value ? '' : t.value)}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                filterType === t.value
                  ? `${t.bg} ${t.color} border-current`
                  : 'bg-white border-black/5 text-zinc-600 hover:bg-zinc-50'
              }`}
            >
              {t.label}
            </button>
          ))}
          <span className="ml-2 text-xs text-zinc-500">状态:</span>
          {(['all', 'todo', 'done'] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilterCompleted(s)}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                filterCompleted === s
                  ? 'bg-zinc-900 text-white border-zinc-900'
                  : 'bg-white border-black/5 text-zinc-700 hover:bg-zinc-50'
              }`}
            >
              {s === 'all' ? '全部' : s === 'todo' ? '未完成' : '已完成'}
            </button>
          ))}
          <button
            onClick={reload}
            disabled={loading}
            className="ml-auto px-2.5 py-1 text-xs bg-white border border-black/5 rounded-full hover:bg-zinc-50 text-zinc-600 inline-flex items-center gap-1"
          >
            {loading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            刷新
          </button>
        </div>

        {/* Content area */}
        {loading && items.length === 0 ? (
          <div className="bg-white/70 backdrop-blur border border-black/5 rounded-2xl p-12 shadow-sm text-center">
            <Loader2 size={28} className="animate-spin mx-auto text-zinc-400" />
            <div className="text-sm text-zinc-500 mt-2">加载中...</div>
          </div>
        ) : view === 'month' ? (
          <MonthView
            gridDays={gridDays}
            year={year}
            month={month}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            dayCount={dayCount}
            selectedList={selectedList}
            onToggle={handleToggle}
            onDelete={handleDelete}
            onAddForDay={openCreateFor}
          />
        ) : (
          <ListView
            grouped={grouped}
            onToggle={handleToggle}
            onDelete={handleDelete}
          />
        )}

        <div className="mt-6 text-center text-xs text-zinc-400">
          点击日期查看当日日程 · 勾选切换完成 · 垃圾桶删除
        </div>
      </div>

      {/* Toast 容器 */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`pointer-events-auto rounded-xl px-4 py-2.5 text-sm shadow-lg border min-w-[200px] flex items-center gap-2 ${
              t.type === 'ok'
                ? 'bg-green-50 border-green-200 text-green-800'
                : t.type === 'err'
                ? 'bg-red-50 border-red-200 text-red-800'
                : 'bg-zinc-50 border-zinc-200 text-zinc-700'
            }`}
          >
            {t.type === 'err' ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-black/5">
              <div className="flex items-center gap-2">
                <Plus size={16} className="text-zinc-700" />
                <h2 className="font-bold text-zinc-800">新建日程</h2>
              </div>
              <button
                onClick={() => setShowCreate(false)}
                className="p-1 hover:bg-zinc-100 rounded"
              >
                <X size={16} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">日期</label>
                <input
                  type="date"
                  value={createDate}
                  onChange={(e) => setCreateDate(e.target.value)}
                  className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">内容</label>
                <input
                  type="text"
                  value={createContent}
                  onChange={(e) => setCreateContent(e.target.value)}
                  placeholder="例如: 复习三角函数"
                  maxLength={256}
                  className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">类型</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {TYPE_OPTIONS.map(t => (
                    <button
                      key={t.value}
                      onClick={() => setCreateType(t.value)}
                      className={`px-2 py-1.5 text-xs rounded-lg border transition-colors ${
                        createType === t.value
                          ? `${t.bg} ${t.color} border-current`
                          : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">备注 (可选)</label>
                <textarea
                  value={createNote}
                  onChange={(e) => setCreateNote(e.target.value)}
                  placeholder="补充说明..."
                  rows={2}
                  className="w-full px-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 p-4 border-t border-black/5 bg-zinc-50">
              <button
                onClick={() => setShowCreate(false)}
                className="px-3 py-1.5 text-sm bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50"
                disabled={creating}
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !createContent.trim()}
                className="px-4 py-1.5 text-sm bg-zinc-900 text-white rounded-lg hover:bg-zinc-700 disabled:opacity-50 inline-flex items-center gap-1"
              >
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// ===== Month View =====
function MonthView(props: {
  gridDays: Date[]
  year: number
  month: number
  selectedDate: string
  onSelectDate: (d: string) => void
  dayCount: Map<string, { total: number; done: number }>
  selectedList: ScheduleItem[]
  onToggle: (it: ScheduleItem) => void
  onDelete: (it: ScheduleItem) => void
  onAddForDay: (d: string) => void
}) {
  const { gridDays, year, month, selectedDate, onSelectDate, dayCount, selectedList, onToggle, onDelete, onAddForDay } = props
  const todayStr = todayISO()
  const weekHeader = ['日', '一', '二', '三', '四', '五', '六']
  return (
    <div className="bg-white/70 backdrop-blur border border-black/5 rounded-2xl p-4 shadow-sm">
      {/* 周标题 */}
      <div className="grid grid-cols-7 gap-1 mb-2">
        {weekHeader.map(w => (
          <div key={w} className="text-center text-xs text-zinc-400 py-1">{w}</div>
        ))}
      </div>
      {/* 42 格子 */}
      <div className="grid grid-cols-7 gap-1">
        {gridDays.map((d, i) => {
          const iso = dateISO(d)
          const inMonth = d.getMonth() === month
          const isToday = iso === todayStr
          const isSelected = iso === selectedDate
          const cnt = dayCount.get(iso)
          return (
            <button
              key={i}
              onClick={() => onSelectDate(iso)}
              className={`relative aspect-square rounded-lg border text-left p-1.5 transition-colors ${
                isSelected
                  ? 'border-blue-500 bg-blue-50'
                  : isToday
                  ? 'border-amber-300 bg-amber-50'
                  : inMonth
                  ? 'border-black/5 bg-white hover:bg-zinc-50'
                  : 'border-transparent bg-zinc-50/40 text-zinc-300'
              }`}
            >
              <div className={`text-xs font-semibold ${
                isSelected ? 'text-blue-700' : isToday ? 'text-amber-700' : inMonth ? 'text-zinc-700' : 'text-zinc-400'
              }`}>
                {d.getDate()}
              </div>
              {cnt && cnt.total > 0 && (
                <div className="absolute bottom-1 right-1 flex items-center gap-0.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    cnt.done === cnt.total ? 'bg-green-500' : 'bg-blue-500'
                  }`} />
                  <span className="text-[10px] text-zinc-500">{cnt.done}/{cnt.total}</span>
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* 选中日列表 */}
      <div className="mt-4 border-t border-black/5 pt-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold text-zinc-700">
            {selectedDate} 的日程
            {selectedList.length > 0 && <span className="text-xs text-zinc-400 ml-2">({selectedList.length})</span>}
          </div>
          <button
            onClick={() => onAddForDay(selectedDate)}
            className="text-xs text-blue-600 hover:text-blue-700 inline-flex items-center gap-1"
          >
            <Plus size={11} /> 这天加一条
          </button>
        </div>
        {selectedList.length === 0 ? (
          <div className="text-center text-zinc-400 text-sm py-6">
            这一天没有日程 · 点上方按钮新建
          </div>
        ) : (
          <div className="space-y-1.5">
            {selectedList.map(it => (
              <ScheduleRow key={it.id} item={it} onToggle={onToggle} onDelete={onDelete} showDate={false} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}


// ===== List View =====
function ListView(props: {
  grouped: Map<string, ScheduleItem[]>
  onToggle: (it: ScheduleItem) => void
  onDelete: (it: ScheduleItem) => void
}) {
  const { grouped, onToggle, onDelete } = props
  if (grouped.size === 0) {
    return (
      <div className="bg-white/70 backdrop-blur border border-black/5 rounded-2xl p-12 shadow-sm text-center">
        <ClipboardList size={36} className="mx-auto text-zinc-300 mb-3" />
        <div className="text-sm text-zinc-700 font-medium">还没有日程</div>
        <div className="text-xs text-zinc-400 mt-1">点右上角「新建」加一条 · 或者去 Chat 让 Agent 帮你排</div>
      </div>
    )
  }
  // 按日期排序输出
  const dates = Array.from(grouped.keys()).sort()
  return (
    <div className="space-y-4">
      {dates.map(date => (
        <div key={date} className="bg-white/70 backdrop-blur border border-black/5 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <BookOpen size={14} className="text-blue-500" />
            <div className="text-sm font-semibold text-zinc-700">{date}</div>
            <div className="text-xs text-zinc-400">({grouped.get(date)!.length})</div>
          </div>
          <div className="space-y-1.5">
            {grouped.get(date)!.map(it => (
              <ScheduleRow key={it.id} item={it} onToggle={onToggle} onDelete={onDelete} showDate={false} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}


// ===== Row =====
function ScheduleRow(props: {
  item: ScheduleItem
  onToggle: (it: ScheduleItem) => void
  onDelete: (it: ScheduleItem) => void
  showDate: boolean
}) {
  const { item, onToggle, onDelete, showDate } = props
  return (
    <div className={`flex items-center gap-3 px-3 py-2 rounded-xl border border-black/5 transition-colors ${
      item.completed ? 'bg-zinc-50' : 'bg-white'
    }`}>
      <button
        onClick={() => onToggle(item)}
        className="flex-shrink-0 hover:scale-110 transition-transform"
        title={item.completed ? '已完成 — 点击取消' : '未完成 — 点击勾选'}
      >
        {item.completed ? (
          <CheckCircle2 size={20} className="text-green-500" />
        ) : (
          <Circle size={20} className="text-zinc-300 hover:text-blue-500" />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div className={`text-sm ${item.completed ? 'line-through text-zinc-400' : 'text-zinc-800'}`}>
          {item.content}
        </div>
        {showDate && (
          <div className="text-xs text-zinc-400 mt-0.5">{item.date}</div>
        )}
        {item.note && (
          <div className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{item.note}</div>
        )}
      </div>
      <span className={`px-2 py-0.5 text-xs rounded-full ${TYPE_BADGE[item.type] || TYPE_BADGE.custom}`}>
        {TYPE_LABEL[item.type] || item.type}
      </span>
      <button
        onClick={() => onDelete(item)}
        className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
        title="删除"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}