import { useState, useEffect } from 'react'
import { User, Save, Sparkles, ChevronDown, ChevronUp, Bot, Activity, Brain, Database, Calendar, BarChart3, CheckCircle2, AlertCircle } from 'lucide-react'
import { getUserProfile, updateUserProfile, getEducationStages, getProfileView, getProfileStats, getLearningTimeline, getPersonas, getPersona, setPersona } from '@/api'
import { useAppStore } from '@/store/useAppStore'
import type { EducationStage, EducationStageOption, ProfileViewResponse } from '@/types'

// v2.0: 前端表单精简到 8 个可编辑字段
//   1. 姓名 (必填)        2. 学段
//   3. 选科               4. 目标院校
//   5. 目标专业           6. 兴趣方向
//   7. 备注               8. Agent 称呼
// 字段 (stage/direction/language/agent_name) 来自 backend-architecture
// 不再展示的 UI 字段: birthday / home_address / emergency_contact
//   (后端 schema 保留, 不删列)

const STAGE_OPTIONS = [
  { value: '小学', label: '小学' },
  { value: '初中', label: '初中' },
  { value: '高中', label: '高中' },
  { value: '职高', label: '职高/中专' },
  { value: '大专', label: '大专' },
  { value: '本科', label: '本科' },
  { value: '考研', label: '考研/硕士' },
  { value: '留学', label: '留学' },
  { value: '在职', label: '在职/工作' },
  { value: '其他', label: '其他' },
]

const SUBJECT_CHOICES = [
  '物化生', '物化地', '物生政',
  '史地政', '史地化', '史政化',
  '未分科 / 其他',
]

const DIRECTION_OPTIONS = [
  { value: '', label: '未选择' },
  { value: '学业', label: '学业 (应试/升学)' },
  { value: '兴趣', label: '兴趣 (探索/拓展)' },
  { value: '职业', label: '职业 (就业/晋升)' },
]

const LANGUAGE_OPTIONS = [
  { value: '中文', label: '中文' },
  { value: '英文', label: '英文' },
  { value: '双语', label: '中英双语' },
]

export default function ProfilePage() {
  const { userProfile, setUserProfile } = useAppStore()
  const [stages] = useState<EducationStageOption[]>([]) // 兼容老字段, 不再使用
  const [form, setForm] = useState({
    name: '',
    stage: '高中',
    subject_choice: '未分科 / 其他',
    target_school: '',
    target_major: '',
    interest: '',
    notes: '',
    agent_name: '张老师',
    direction: '',
    language: '中文',
  })
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{type: 'ok' | 'err'; text: string} | null>(null)  // v0.1.7+: 保存提示 toast
  const [profileView, setProfileView] = useState<ProfileViewResponse | null>(null)
  const [showAIView, setShowAIView] = useState(false)
  // v0.1.7: 学情统计 + 学习轨迹 + 人格
  const [stats, setStats] = useState<any>(null)
  const [timeline, setTimeline] = useState<any>(null)
  const [personas, setPersonas] = useState<Array<{value: string; label: string; desc: string; scenario_fit: string[]}>>([])
  const [currentPersona, setCurrentPersona] = useState<string>('teacher_zhang')
  const [personaSwitching, setPersonaSwitching] = useState<string | null>(null)

  // v0.1.7+: 修复 — 主动 load userProfile (原来 useEffect 依赖 userProfile, 但 store 初始是 null, 永远不跑)
  const [profileLoaded, setProfileLoaded] = useState(false)
  useEffect(() => {
    if (profileLoaded) return  // 只 load 一次
    let cancelled = false
    ;(async () => {
      try {
        const p = await getUserProfile()
        if (!cancelled) {
          setUserProfile(p)
          populateForm(p)
          setProfileLoaded(true)
        }
      } catch (e) {
        console.error('加载 profile 失败:', e)
      }
    })()
    loadProfileView()
    loadStats()
    loadTimeline()
    loadPersonas()
    loadCurrentPersona()
    return () => { cancelled = true }
  }, [])

  const loadStats = async () => {
    try { setStats(await getProfileStats()) } catch (e) { console.error(e) }
  }
  const loadTimeline = async () => {
    try { setTimeline(await getLearningTimeline(30)) } catch (e) { console.error(e) }
  }
  const loadPersonas = async () => {
    try { setPersonas(await getPersonas()) } catch (e) { console.error(e) }
  }
  const loadCurrentPersona = async () => {
    try { setCurrentPersona(await getPersona()) } catch (e) { console.error(e) }
  }
  const handleSwitchPersona = async (next: string) => {
    if (personaSwitching) return
    setPersonaSwitching(next)
    try {
      const r = await setPersona(next)
      setCurrentPersona(r.persona)
      setUserProfile({ ...(userProfile as any), persona: r.persona })
    } catch (e: any) {
      alert('切换人格失败: ' + (e?.message || '?'))
    } finally {
      setPersonaSwitching(null)
    }
  }

  const loadStages = async () => {
    // 兼容老调用, 不再用
    try { await getEducationStages() } catch (e) { console.error(e) }
  }

  const loadProfileView = async () => {
    try {
      const v = await getProfileView()
      setProfileView(v)
    } catch (e) {
      console.error('loadProfileView:', e)
    }
  }

  const populateForm = (p: any) => {
    setForm({
      name: p.name || '',
      stage: p.stage || '高中',
      subject_choice: p.subject_choice || '未分科 / 其他',
      target_school: p.target_school || '',
      target_major: p.target_major || '',
      interest: p.interest || p.interests || '',
      notes: p.notes || p.background || '',
      agent_name: p.agent_name || '张老师',
      direction: p.direction || '',
      language: p.language || '中文',
    })
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const data: any = {
        name: form.name || 'Student',
        stage: form.stage,
        subject_choice: form.subject_choice,
        target_school: form.target_school,
        target_major: form.target_major,
        interest: form.interest,
        notes: form.notes,
        agent_name: form.agent_name,
        direction: form.direction,
        language: form.language,
      }
      await updateUserProfile(data)
      const updated = await getUserProfile()
      setUserProfile(updated)
      populateForm(updated)  // v0.1.7+: 刷新 form state (保证 UI 看到最新值)
      await loadProfileView()  // 刷新"AI 怎么理解我"
      // v0.1.7+: 用 toast 替代 alert (alert 在某些浏览器被阻止, 不友好)
      setSaveMsg({ type: 'ok', text: '保存成功' })
      setTimeout(() => setSaveMsg(null), 2000)
    } catch (e: any) {
      setSaveMsg({ type: 'err', text: '保存失败: ' + (e?.message || '?') })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-zx-red to-orange-500 flex items-center justify-center text-white text-2xl font-bold">
            {form.name?.[0] || '?'}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-800">{form.name || '未设置'}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {form.stage ? `${form.stage}` : '设置你的学段'} · {form.agent_name}
            </p>
          </div>
        </div>

        {/* v2.0: AI 怎么理解我 — 折叠区 (默认展开) */}
        <div className="bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200 rounded-lg mb-4">
          <button
            onClick={() => setShowAIView(!showAIView)}
            className="w-full px-4 py-3 flex items-center justify-between text-left"
          >
            <div className="flex items-center gap-2">
              <Bot size={16} className="text-purple-600" />
              <span className="text-sm font-semibold text-purple-700">
                AI 怎么理解我
              </span>
              <span className="text-xs text-purple-500">
                (点开看 Agent 实际读到的画像)
              </span>
            </div>
            {showAIView ? <ChevronUp size={16} className="text-purple-600" /> : <ChevronDown size={16} className="text-purple-600" />}
          </button>
          {showAIView && profileView && (
            <div className="px-4 pb-4 border-t border-purple-200">
              {profileView.derived_rules.length > 0 ? (
                <div className="mt-3">
                  <div className="text-xs font-semibold text-purple-700 mb-1">注入指令</div>
                  <ul className="space-y-1 text-sm text-gray-700">
                    {profileView.derived_rules.map((r, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="text-purple-500 mt-0.5">•</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="mt-3 text-xs text-gray-500">暂无注入指令 (字段都是默认值)</div>
              )}
              <details className="mt-3">
                <summary className="text-xs text-purple-600 cursor-pointer hover:underline">
                  展开看完整 prompt 片段
                </summary>
                <pre className="mt-2 p-3 bg-white rounded border border-purple-200 text-xs text-gray-700 whitespace-pre-wrap overflow-x-auto max-h-64 overflow-y-auto">
                  {profileView.preview_prompt}
                </pre>
              </details>
            </div>
          )}
        </div>

        {/* Form: v2.0 精简版 (8 个可编辑字段) */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h2 className="font-bold mb-4 flex items-center gap-2">
            <User size={18} className="text-purple-500" />
            基本信息
            <span className="text-xs text-gray-500 font-normal">（8 项核心字段, 其他都是选填）</span>
          </h2>

          <div className="space-y-4">
            {/* 1. 姓名 */}
            <div>
              <label className="text-sm text-gray-600">姓名 / 昵称 *</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="怎么称呼你？"
                className="w-full mt-1 border rounded-lg px-3 py-2"
              />
            </div>

            {/* 2. 学段 */}
            <div>
              <label className="text-sm text-gray-600">学段 *</label>
              <div className="mt-2 grid grid-cols-5 gap-2">
                {STAGE_OPTIONS.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setForm({ ...form, stage: s.value })}
                    className={`p-2 text-xs rounded-lg border-2 transition-all ${
                      form.stage === s.value
                        ? 'border-zx-red bg-red-50 text-zx-red'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="mt-1">{s.label}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 3. 选科 (仅高中展示) */}
            {form.stage === '高中' && (
              <div>
                <label className="text-sm text-gray-600">选科（选填, 高考 3+1+2）</label>
                <select
                  value={form.subject_choice}
                  onChange={(e) => setForm({ ...form, subject_choice: e.target.value })}
                  className="w-full mt-1 border rounded-lg px-3 py-2"
                >
                  {SUBJECT_CHOICES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}

            {/* 4. 目标院校 */}
            <div>
              <label className="text-sm text-gray-600">目标院校（选填）</label>
              <input
                type="text"
                value={form.target_school}
                onChange={(e) => setForm({ ...form, target_school: e.target.value })}
                placeholder="如：武汉大学 / 北航 / 计算机强校"
                className="w-full mt-1 border rounded-lg px-3 py-2"
              />
            </div>

            {/* 5. 目标专业 */}
            <div>
              <label className="text-sm text-gray-600">目标专业（选填）</label>
              <input
                type="text"
                value={form.target_major}
                onChange={(e) => setForm({ ...form, target_major: e.target.value })}
                placeholder="如：计算机科学 / 临床医学 / 软件工程"
                className="w-full mt-1 border rounded-lg px-3 py-2"
              />
            </div>

            {/* 6. 兴趣方向 */}
            <div>
              <label className="text-sm text-gray-600">兴趣方向（选填）</label>
              <textarea
                value={form.interest}
                onChange={(e) => setForm({ ...form, interest: e.target.value })}
                placeholder="对什么方向感兴趣？比如：编程、文学、艺术..."
                rows={2}
                className="w-full mt-1 border rounded-lg px-3 py-2"
              />
            </div>

            {/* 7. 备注 */}
            <div>
              <label className="text-sm text-gray-600">备注（选填）</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="任何你想让 Agent 知道的背景信息..."
                rows={2}
                className="w-full mt-1 border rounded-lg px-3 py-2"
              />
            </div>

            {/* 8. Agent 称呼 */}
            <div>
              <label className="text-sm text-gray-600">Agent 称呼</label>
              <div className="flex gap-2 mt-1">
                <input
                  type="text"
                  value={form.agent_name}
                  onChange={(e) => setForm({ ...form, agent_name: e.target.value })}
                  placeholder="默认: 张老师"
                  className="flex-1 border rounded-lg px-3 py-2"
                />
                <button
                  onClick={() => setForm({ ...form, agent_name: '张老师' })}
                  className="px-3 py-2 text-xs border rounded-lg hover:bg-gray-50"
                >
                  恢复默认
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                自定义后, Agent 自我介绍时会用这个称呼 (不再自称"张老师")
              </p>
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full py-3 bg-zx-red text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <Save size={18} />
              {saving ? '保存中...' : '保存信息'}
            </button>
            {/* v0.1.7+: 保存结果 toast (替代 alert) */}
            {saveMsg && (
              <div className={`mt-3 px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${
                saveMsg.type === 'ok' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200'
              }`}>
                {saveMsg.type === 'ok' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                <span>{saveMsg.text}</span>
              </div>
            )}
          </div>

          {/* v0.1.7: Agent 人格选择 (v0.9.1 plan 中"预留"的多角色实际接入) */}
          <div className="mt-8 pt-6 border-t border-gray-200">
            <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Bot size={14} className="text-violet-600" />
              Agent 人格
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {personas.map((p) => {
                const active = p.value === currentPersona
                return (
                  <button
                    key={p.value}
                    onClick={() => handleSwitchPersona(p.value)}
                    disabled={!!personaSwitching}
                    className={`text-left p-3 rounded-lg border transition-all ${
                      active
                        ? 'border-violet-500 bg-violet-50 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-violet-300'
                    } ${personaSwitching && !active ? 'opacity-50' : ''}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-gray-800">{p.label}</span>
                      {active && <span className="text-[10px] px-1.5 py-0.5 bg-violet-500 text-white rounded">当前</span>}
                      {personaSwitching === p.value && (
                        <span className="text-[10px] text-violet-600">切换中...</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500">{p.desc}</p>
                    <div className="flex gap-1 mt-2">
                      {p.scenario_fit.map((s) => (
                        <span key={s} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">
                          {s === 'chat' ? '答疑' : s === 'exam' ? '考试' : s === 'volunteer' ? '志愿' : s === 'chitchat' ? '闲聊' : s}
                        </span>
                      ))}
                    </div>
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              人格会注入到 system prompt, 立即生效 (下次对话自动应用)
            </p>
          </div>

          {/* v0.1.7: 学情雷达图 (画像可视化) */}
          {stats && (
            <div className="mt-8 pt-6 border-t border-gray-200">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <BarChart3 size={14} className="text-purple-600" />
                学情概览
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-blue-900">{stats.total_mistakes}</div>
                  <div className="text-xs text-blue-700">错题总数</div>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-green-900">{Math.round((stats.mastered_rate || 0) * 100)}%</div>
                  <div className="text-xs text-green-700">掌握率</div>
                </div>
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-orange-900">{stats.mastered}</div>
                  <div className="text-xs text-orange-700">已掌握</div>
                </div>
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-purple-900">{stats.conversation_count}</div>
                  <div className="text-xs text-purple-700">对话数</div>
                </div>
              </div>

              {/* 学科分布雷达图 (纯 SVG) */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <RadarChart
                  title="学科错题分布"
                  data={Object.entries(stats.by_subject || {}).map(([k, v]) => ({ label: k, value: v as number }))}
                  maxValue={Math.max(...Object.values(stats.by_subject || {}).map(v => v as number), 1)}
                />
                <RadarChart
                  title="难度分布 (1-5)"
                  data={[1, 2, 3, 4, 5].map(d => ({
                    label: `难度${d}`,
                    value: (stats.by_difficulty || {})[d] || 0,
                  }))}
                  maxValue={Math.max(...Object.values(stats.by_difficulty || {}).map(v => v as number), 1)}
                />
              </div>

              {/* Top 知识点 */}
              {stats.top_knowledge_tags && stats.top_knowledge_tags.length > 0 && (
                <div className="mt-4 bg-white border border-gray-200 rounded-lg p-3">
                  <div className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                    <Brain size={12} /> 出现频次 Top 10 知识点
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {stats.top_knowledge_tags.map((t: any) => (
                      <span key={t.tag} className="text-xs px-2 py-1 bg-cyan-50 border border-cyan-200 text-cyan-700 rounded-full">
                        #{t.tag} <span className="text-cyan-500">×{t.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* v0.1.7: 学习轨迹图 (最近 30 天) */}
          {timeline && timeline.items && timeline.items.length > 0 && (
            <div className="mt-8 pt-6 border-t border-gray-200">
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Calendar size={14} className="text-emerald-600" />
                学习轨迹 (最近 {timeline.days} 天)
              </h3>
              <LearningTimeline items={timeline.items} />
            </div>
          )}

          {/* 配置项 — 折叠到下方, 不算主表单 */}
          <details className="mt-6 pt-4 border-t border-gray-100">
            <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-700 flex items-center gap-1">
              <Sparkles size={12} />
              高级配置 (目标方向 / 语言偏好)
            </summary>
            <div className="mt-3 space-y-3 pl-4">
              <div>
                <label className="text-xs text-gray-600">目标方向</label>
                <select
                  value={form.direction}
                  onChange={(e) => setForm({ ...form, direction: e.target.value })}
                  className="w-full mt-1 border rounded-lg px-3 py-2 text-sm"
                >
                  {DIRECTION_OPTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-600">语言偏好</label>
                <select
                  value={form.language}
                  onChange={(e) => setForm({ ...form, language: e.target.value })}
                  className="w-full mt-1 border rounded-lg px-3 py-2 text-sm"
                >
                  {LANGUAGE_OPTIONS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
                </select>
              </div>
            </div>
          </details>
        </div>

        {/* Tip — 保留原小贴士 */}
        <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-700">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={16} />
            <span className="font-semibold">小提示</span>
          </div>
          <p className="text-xs">填写信息越详细, {form.agent_name} 给的建议越个性化。点开上方"AI 怎么理解我"可以实时预览 Agent 读到的画像。</p>
        </div>
      </div>
    </div>
  )
}

// ===== v0.1.7: SVG 雷达图 (无依赖) =====
function RadarChart({ title, data, maxValue }: { title: string; data: Array<{label: string; value: number}>; maxValue: number }) {
  if (!data || data.length === 0) return null

  const size = 240
  const center = size / 2
  const radius = 80
  const angleStep = (Math.PI * 2) / data.length

  // 多边形顶点 (归一化到 0-1, 再乘 radius)
  const points = data.map((d, i) => {
    const angle = -Math.PI / 2 + i * angleStep
    const r = maxValue > 0 ? (d.value / maxValue) * radius : 0
    return {
      x: center + Math.cos(angle) * r,
      y: center + Math.sin(angle) * r,
      labelX: center + Math.cos(angle) * (radius + 18),
      labelY: center + Math.sin(angle) * (radius + 18),
      angle,
    }
  })

  // 网格圈 (5 圈)
  const rings = [0.2, 0.4, 0.6, 0.8, 1.0]
  const gridPolygons = rings.map(r => {
    return data.map((_, i) => {
      const angle = -Math.PI / 2 + i * angleStep
      const x = center + Math.cos(angle) * radius * r
      const y = center + Math.sin(angle) * radius * r
      return `${x},${y}`
    }).join(' ')
  })

  const dataPolygon = points.map(p => `${p.x},${p.y}`).join(' ')

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="text-xs text-gray-500 mb-2">{title}</div>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-auto">
        {/* 网格圈 */}
        {gridPolygons.map((poly, i) => (
          <polygon key={i} points={poly} fill="none" stroke="#e5e7eb" strokeWidth="0.5" />
        ))}
        {/* 轴线 */}
        {points.map((p, i) => (
          <line key={i} x1={center} y1={center} x2={p.labelX - Math.cos(p.angle) * 18} y2={p.labelY - Math.sin(p.angle) * 18} stroke="#e5e7eb" strokeWidth="0.5" />
        ))}
        {/* 数据多边形 */}
        <polygon points={dataPolygon} fill="rgba(124, 58, 237, 0.25)" stroke="#7c3aed" strokeWidth="2" />
        {/* 数据点 */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill="#7c3aed" />
        ))}
        {/* 标签 */}
        {points.map((p, i) => (
          <text key={i} x={p.labelX} y={p.labelY} textAnchor="middle" dominantBaseline="middle" fontSize="11" fill="#374151">
            {data[i].label} ({data[i].value})
          </text>
        ))}
      </svg>
    </div>
  )
}


// ===== v0.1.7: 学习轨迹图 (柱状图, 按天) =====
function LearningTimeline({ items }: { items: Array<{date: string; mistakes_added: number; schedules_done: number; messages: number}> }) {
  // 限制最近 14 天显示 (避免太长)
  const recent = items.slice(0, 14).reverse()  // 旧→新

  if (recent.length === 0) {
    return <div className="text-xs text-gray-400 text-center py-4">最近 30 天暂无学习记录</div>
  }

  // 找最大值用于缩放
  const maxVal = Math.max(...recent.flatMap(d => [d.mistakes_added, d.schedules_done, d.messages]), 1)

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3 overflow-x-auto">
      <div className="flex items-end gap-1 h-32 min-w-[500px]">
        {recent.map((d) => (
          <div key={d.date} className="flex-1 flex flex-col items-center gap-0.5 min-w-[36px]">
            <div className="flex items-end gap-0.5 w-full justify-center" style={{ height: '100%' }}>
              <div
                className="w-2 bg-red-400 rounded-t"
                style={{ height: `${(d.mistakes_added / maxVal) * 100}%`, minHeight: d.mistakes_added > 0 ? '2px' : '0' }}
                title={`${d.date} 错题+${d.mistakes_added}`}
              />
              <div
                className="w-2 bg-emerald-400 rounded-t"
                style={{ height: `${(d.schedules_done / maxVal) * 100}%`, minHeight: d.schedules_done > 0 ? '2px' : '0' }}
                title={`${d.date} 完成日程+${d.schedules_done}`}
              />
              <div
                className="w-2 bg-blue-400 rounded-t"
                style={{ height: `${(d.messages / maxVal) * 100}%`, minHeight: d.messages > 0 ? '2px' : '0' }}
                title={`${d.date} 消息+${d.messages}`}
              />
            </div>
            <div className="text-[9px] text-gray-400 truncate w-full text-center">{d.date.slice(5)}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-3 text-xs text-gray-500 justify-center">
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-red-400 rounded" />错题</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-400 rounded" />完成日程</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 bg-blue-400 rounded" />消息</span>
      </div>
    </div>
  )
}
