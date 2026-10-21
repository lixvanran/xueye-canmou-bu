/**
 * ReviewPage — 学习主线主页
 *
 * 三块合一 (对应"比付费软件好"的三件事):
 *   1. 今日复习队列 —— 到期的错题 + 薄弱知识点, 分开给 (重做旧错题 vs 补薄弱点 是两件事)
 *   2. 闪卡         —— 知识点卡, 按掌握度排序, 翻卡自评
 *   3. 掌握度全景   —— 哪些知识点是黑洞, 一眼看到
 *
 * v1.3.0
 */
import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, BookOpen, Brain, CheckCircle2, ChevronRight, Flame, RotateCcw,
  Target, TrendingDown, X,
} from 'lucide-react'
import {
  flashcards, listMistakes, listMastery as apiMastery, reviewMistake, reviewQueue,
  type Flashcard, type MasteryItem, type MistakeItem, type ReviewQueue,
} from '@/api/learning'

type Tab = 'today' | 'cards' | 'mastery'

const SUBJECTS = ['全部', '数学', '物理', '化学', '英语', '语文', '生物', '历史', '地理', '政治']

function fmtDue(ts: string | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const days = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 7) return `${days} 天前`
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })
}

const MASTERY_STYLE: Record<number, { bg: string; text: string; bar: string }> = {
  0: { bg: 'bg-red-100', text: 'text-red-700', bar: 'bg-red-500' },
  1: { bg: 'bg-orange-100', text: 'text-orange-700', bar: 'bg-orange-500' },
  2: { bg: 'bg-amber-100', text: 'text-amber-700', bar: 'bg-amber-500' },
  3: { bg: 'bg-blue-100', text: 'text-blue-700', bar: 'bg-blue-500' },
  4: { bg: 'bg-green-100', text: 'text-green-700', bar: 'bg-green-500' },
  5: { bg: 'bg-emerald-100', text: 'text-emerald-700', bar: 'bg-emerald-500' },
}

export default function ReviewPage() {
  const [tab, setTab] = useState<Tab>('today')
  const [subject, setSubject] = useState('全部')
  const [queue, setQueue] = useState<ReviewQueue | null>(null)
  const [cards, setCards] = useState<Flashcard[]>([])
  const [masteryList, setMasteryList] = useState<MasteryItem[]>([])
  const [mistakes, setMistakes] = useState<MistakeItem[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setErr(null)
    try {
      const subj = subject === '全部' ? undefined : subject
      const [q, c, m, mk] = await Promise.all([
        reviewQueue(20),
        flashcards({ subject: subj, limit: 40 }),
        apiMastery({ subject: subj }),
        listMistakes({ subject: subj, limit: 100 }),
      ])
      setQueue(q)
      setCards(c.items)
      setMasteryList(m.items)
      setMistakes(mk.items)
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [subject])

  const dueMistakes = queue?.due_mistakes || []
  const weak = queue?.weak_points || []
  const totalDue = (queue?.counts?.due_mistakes || 0) + (queue?.counts?.weak_points || 0)

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-400 text-sm">
        加载中...
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto bg-zinc-50">
      <div className="max-w-4xl mx-auto px-4 py-5">
        {/* ===== 顶部: 今日概览 ===== */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-bold text-zinc-800">学习主线</h1>
            <p className="text-xs text-zinc-500 mt-0.5">
              {totalDue > 0
                ? `今天有 ${totalDue} 项要练`
                : '今天没有到期的复习 —— 记两道错题或者去刷几道闪卡'}
            </p>
          </div>
          <button
            onClick={load}
            className="p-2 rounded-lg hover:bg-zinc-200 text-zinc-500 transition-colors"
            title="刷新"
          >
            <RotateCcw size={16} />
          </button>
        </div>

        {/* ===== 统计卡 ===== */}
        <div className="grid grid-cols-4 gap-2 mb-4">
          <StatCard label="总错题" value={queue?.counts?.total_mistakes ?? 0} icon={<BookOpen size={13} />} color="text-indigo-500" />
          <StatCard label="待复习" value={queue?.counts?.due_mistakes ?? 0} icon={<Flame size={13} />} color="text-red-500" />
          <StatCard label="已掌握" value={queue?.counts?.mastered_mistakes ?? 0} icon={<CheckCircle2 size={13} />} color="text-emerald-500" />
          <StatCard label="薄弱点" value={queue?.counts?.weak_points ?? 0} icon={<Target size={13} />} color="text-orange-500" />
        </div>

        {/* ===== Tab ===== */}
        <div className="flex gap-1 mb-4 bg-zinc-200/60 p-1 rounded-lg">
          {([
            ['today', '今日复习', totalDue],
            ['cards', '闪卡', cards.length],
            ['mastery', '掌握度', masteryList.length],
          ] as [Tab, string, number][]).map(([k, label, n]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors ${
                tab === k ? 'bg-white text-zinc-800 shadow-sm' : 'text-zinc-600 hover:text-zinc-800'
              }`}
            >
              {label} {n > 0 && <span className="text-zinc-400">({n})</span>}
            </button>
          ))}
        </div>

        {err && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs mb-4">
            {err}
          </div>
        )}

        {/* ===== Tab: 今日复习 ===== */}
        {tab === 'today' && (
          <div className="space-y-4">
            <SectionTitle icon={<Flame size={14} />} title="到期的错题" count={dueMistakes.length} hint="重做这些题, 答对 3 次就算掌握" />
            {dueMistakes.length === 0 ? (
              <Empty text="没有到期的错题。做完的题会在到期后自动回来。" />
            ) : (
              dueMistakes.map(m => <MistakeCard key={m.id} item={m} onDone={load} />)
            )}

            <SectionTitle icon={<Target size={14} />} title="该补的知识点" count={weak.length} hint="掌握度低的知识点, 忘了会更快" />
            {weak.length === 0 ? (
              <Empty text="没有明显薄弱点。" />
            ) : (
              <div className="grid sm:grid-cols-2 gap-2">
                {weak.map(w => (
                  <div key={w.kp_name} className="p-3 bg-white rounded-lg border border-zinc-200">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-sm font-medium text-zinc-800 truncate">{w.kp_name}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${MASTERY_STYLE[w.level]?.bg} ${MASTERY_STYLE[w.level]?.text}`}>
                        {w.label}
                      </span>
                    </div>
                    <MasteryBar level={w.level} />
                    <div className="text-[10px] text-zinc-400 mt-1.5">
                      错 {w.wrong_count} 次 · 对 {w.correct_count} 次
                      {w.due && ' · 待复习'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===== Tab: 闪卡 ===== */}
        {tab === 'cards' && (
          <div>
            <div className="mb-3 flex gap-1 flex-wrap">
              {SUBJECTS.map(s => (
                <button
                  key={s}
                  onClick={() => setSubject(s)}
                  className={`px-2 py-1 rounded-full text-[11px] font-medium transition-colors ${
                    subject === s ? 'bg-indigo-600 text-white' : 'bg-white text-zinc-600 border border-zinc-200 hover:border-indigo-300'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            {cards.length === 0 ? (
              <Empty text="这个学科还没有知识点卡片。" />
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {cards.map(c => <FlashcardView key={c.id} card={c} />)}
              </div>
            )}
          </div>
        )}

        {/* ===== Tab: 掌握度 ===== */}
        {tab === 'mastery' && (
          <div>
            {masteryList.length === 0 ? (
              <Empty text="还没有掌握度数据。录入错题或做完闪卡自评后就会出现。" />
            ) : (
              <div className="space-y-1.5">
                {masteryList.map(m => (
                  <div key={m.kp_name} className="p-3 bg-white rounded-lg border border-zinc-200">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-medium text-zinc-800 truncate">{m.kp_name}</span>
                        {m.subject && (
                          <span className="px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 text-[10px] flex-shrink-0">{m.subject}</span>
                        )}
                      </div>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${MASTERY_STYLE[m.level]?.bg} ${MASTERY_STYLE[m.level]?.text}`}>
                        {m.label}
                      </span>
                    </div>
                    <MasteryBar level={m.level} />
                    <div className="flex items-center gap-3 text-[10px] text-zinc-400 mt-1.5">
                      <span>对 {m.correct_count}</span>
                      <span>错 {m.wrong_count}</span>
                      {m.accuracy !== null && <span>正确率 {(m.accuracy * 100).toFixed(0)}%</span>}
                      {m.streak > 0 && <span className="text-emerald-600">连对 {m.streak}</span>}
                      {m.next_review_at && <span>下次 {fmtDue(m.next_review_at)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: any; color: string }) {
  return (
    <div className="p-2.5 bg-white rounded-lg border border-zinc-200">
      <div className={`flex items-center gap-1 text-[10px] ${color} mb-0.5`}>{icon}{label}</div>
      <div className="text-xl font-bold text-zinc-800 leading-none">{value}</div>
    </div>
  )
}

function SectionTitle({ icon, title, count, hint }: { icon: any; title: string; count: number; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-2">
      <span className="text-zinc-500">{icon}</span>
      <span className="text-sm font-semibold text-zinc-700">{title}</span>
      <span className="text-xs text-zinc-400">({count})</span>
      {hint && <span className="text-[11px] text-zinc-400 ml-auto">{hint}</span>}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className="p-6 text-center text-sm text-zinc-400 bg-white rounded-lg border border-dashed border-zinc-200">
      {text}
    </div>
  )
}

function MasteryBar({ level }: { level: number }) {
  return (
    <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${MASTERY_STYLE[level]?.bar || 'bg-zinc-400'}`}
        style={{ width: `${((level + 1) / 6) * 100}%` }}
      />
    </div>
  )
}

/** 错题卡 —— 自评对错, 立刻回写掌握度 */
function MistakeCard({ item, onDone }: { item: MistakeItem; onDone: () => void }) {
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  const answer = async (ok: boolean) => {
    setBusy(true)
    try {
      const r = await reviewMistake(item.id, ok)
      const up = r.mastery_updates?.[0]
      setResult(ok
        ? `答对 ✓ 掌握度 ${up?.label ?? ''} · ${up?.reason?.split(',').slice(1).join(',') ?? ''}`
        : `答错 · 掌握度降到 ${up?.label ?? ''} · 明天再来一次`)
      setTimeout(() => { setShow(false); setResult(null); onDone() }, 1800)
    } catch (e: any) {
      setResult(e?.response?.data?.detail || '提交失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-3 bg-white rounded-lg border border-zinc-200 mb-2">
      <div className="flex items-start gap-2">
        <span className="px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 text-[10px] font-mono flex-shrink-0 mt-0.5">{item.code}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium text-zinc-800">{item.title}</span>
            {item.subject && <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 text-[10px]">{item.subject}</span>}
            {item.difficulty >= 4 && <AlertTriangle size={12} className="text-orange-500" />}
          </div>
          {item.knowledge_tags.length > 0 && (
            <div className="flex gap-1 flex-wrap mt-1.5">
              {item.knowledge_tags.map(t => (
                <span key={t} className="px-1.5 py-0.5 rounded bg-red-50 text-red-600 text-[10px]">{t}</span>
              ))}
            </div>
          )}
          {item.cause_label && (
            <div className="text-[11px] text-zinc-400 mt-1">错因: {item.cause_label} · 已复习 {item.review_count} 次</div>
          )}

          {show && (
            <div className="mt-2 p-2.5 bg-zinc-50 rounded text-xs space-y-1.5">
              {item.content && <div className="text-zinc-700 whitespace-pre-wrap">{item.content}</div>}
              {item.my_answer && <div className="text-zinc-500">我的答案: <span className="text-red-600">{item.my_answer}</span></div>}
              {item.correct_answer && <div className="text-zinc-500">正确答案: <span className="text-emerald-600">{item.correct_answer}</span></div>}
            </div>
          )}

          {result && <div className="mt-2 text-xs text-indigo-600">{result}</div>}

          {!result && (
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => setShow(!show)}
                className="text-[11px] text-zinc-500 hover:text-zinc-700 flex items-center gap-0.5"
              >
                <ChevronRight size={12} className={show ? 'rotate-90 transition-transform' : 'transition-transform'} />
                {show ? '收起' : '看题目'}
              </button>
              <div className="flex-1" />
              <button
                onClick={() => answer(false)}
                disabled={busy}
                className="px-2.5 py-1 rounded-md bg-red-50 text-red-600 text-[11px] font-medium hover:bg-red-100 disabled:opacity-50"
              >
                <X size={11} className="inline mr-0.5" />还是不会
              </button>
              <button
                onClick={() => answer(true)}
                disabled={busy}
                className="px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-600 text-[11px] font-medium hover:bg-emerald-100 disabled:opacity-50"
              >
                <CheckCircle2 size={11} className="inline mr-0.5" />会了
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 闪卡 —— 正面问题, 翻面看答案 + 易错点 */
function FlashcardView({ card }: { card: Flashcard }) {
  const [flipped, setFlipped] = useState(false)
  const style = MASTERY_STYLE[card.mastery ?? 0]

  return (
    <div
      onClick={() => setFlipped(!flipped)}
      className="p-3 bg-white rounded-lg border border-zinc-200 cursor-pointer hover:border-indigo-300 transition-colors"
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-sm font-medium text-zinc-800 truncate">{card.name}</span>
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500 text-[10px]">{card.subject}</span>
          {card.practiced ? (
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${style.bg} ${style.text}`}>{card.mastery_label}</span>
          ) : (
            <span className="px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-400 text-[10px]">未练</span>
          )}
        </div>
      </div>

      {flipped ? (
        <div className="text-xs space-y-1.5">
          {card.summary && <div className="text-zinc-700">{card.summary}</div>}
          {card.formula && (
            <div className="p-1.5 bg-indigo-50 rounded font-mono text-indigo-800 text-[11px] break-all">{card.formula}</div>
          )}
          {card.pitfalls.length > 0 && (
            <div>
              <div className="text-red-500 font-medium mb-0.5">易错点</div>
              <ul className="list-disc list-inside text-zinc-600 space-y-0.5">
                {card.pitfalls.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          )}
          {card.exam_points.length > 0 && (
            <div>
              <div className="text-zinc-500 font-medium mb-0.5">常考</div>
              <div className="flex gap-1 flex-wrap">
                {card.exam_points.map((p, i) => (
                  <span key={i} className="px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-600 text-[10px]">{p}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-zinc-500">
          {card.aliases.length > 0 && <span className="text-zinc-400">别名: {card.aliases.join(' / ')}</span>}
          <div className="text-zinc-400 mt-1">点击翻面</div>
        </div>
      )}
    </div>
  )
}
