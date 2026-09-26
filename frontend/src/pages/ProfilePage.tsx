import { useState, useEffect } from 'react'
import { User, Save, Sparkles, ChevronDown, ChevronUp, Bot } from 'lucide-react'
import { getUserProfile, updateUserProfile, getEducationStages, getProfileView } from '@/api'
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
  { value: '小学', label: '小学', icon: '🎒' },
  { value: '初中', label: '初中', icon: '📚' },
  { value: '高中', label: '高中', icon: '🎓' },
  { value: '职高', label: '职高/中专', icon: '🔧' },
  { value: '大专', label: '大专', icon: '🏫' },
  { value: '本科', label: '本科', icon: '🎯' },
  { value: '考研', label: '考研/硕士', icon: '📖' },
  { value: '留学', label: '留学', icon: '✈️' },
  { value: '在职', label: '在职/工作', icon: '💼' },
  { value: '其他', label: '其他', icon: '✨' },
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
  const [profileView, setProfileView] = useState<ProfileViewResponse | null>(null)
  const [showAIView, setShowAIView] = useState(false)

  useEffect(() => {
    loadStages()
    if (userProfile) populateForm(userProfile)
    loadProfileView()
  }, [userProfile])

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
      await loadProfileView()  // 刷新"AI 怎么理解我"
      alert('保存成功！')
    } catch (e: any) {
      alert('保存失败: ' + e.message)
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
                  <div className="text-xs font-semibold text-purple-700 mb-1">📌 注入指令</div>
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
                    <div className="text-lg">{s.icon}</div>
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
          </div>

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