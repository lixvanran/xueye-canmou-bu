import { useState, useEffect, useRef } from 'react'
import { Upload, Trash2, Search, BookOpen, AlertCircle, CheckCircle, X, FileText, Edit3, Save, Sparkles, UserCircle2, Loader2, Star, Package, ListChecks } from 'lucide-react'
import {
  listResources, createResource, deleteResource, getResource,
  updateResource, markResourceMastered, getResourceStats, listKnowledgeTags,
} from '@/api'
import { streamExplainMistake, getWeakTopics } from '@/api/workspace'
import type { Resource, ResourceType } from '@/types'

const subjects = ['数学', '语文', '英语', '物理', '化学', '生物', '历史', '地理', '政治', '计算机', '其他']
const errorTypes = [
  { value: 'calculation', label: '计算错误', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'concept', label: '概念不清', color: 'bg-red-100 text-red-700' },
  { value: 'method', label: '方法不会', color: 'bg-orange-100 text-orange-700' },
  { value: 'unfamiliar', label: '题型陌生', color: 'bg-blue-100 text-blue-700' },
]

// v2.0: 难度星渲染 1-5
function DifficultyStars({ value = 3, onChange }: { value?: number; onChange?: (v: number) => void }) {
  const v = Math.max(1, Math.min(5, value || 3))
  return (
    <div className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <button
          key={i}
          type="button"
          onClick={() => onChange?.(i)}
          disabled={!onChange}
          className={`p-0.5 ${i <= v ? 'text-yellow-500' : 'text-gray-300'} ${onChange ? 'hover:text-yellow-600 cursor-pointer' : 'cursor-default'}`}
          title={`难度 ${i}/5`}
        >
          <Star size={14} fill={i <= v ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  )
}

export default function ResourcesPage() {
  const [resources, setResources] = useState<Resource[]>([])
  const [stats, setStats] = useState<any>(null)
  const [activeTab, setActiveTab] = useState<ResourceType>('mistake')
  const [showUpload, setShowUpload] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [search, setSearch] = useState('')
  const [filterSubject, setFilterSubject] = useState('')

  // v2.0: 按知识点筛选 (错题 tab 有效)
  const [filterKnowledgeTag, setFilterKnowledgeTag] = useState('')
  const [allKnowledgeTags, setAllKnowledgeTags] = useState<string[]>([])

  // Detail view
  const [selected, setSelected] = useState<Resource | null>(null)
  // v0.1.6: 一键整理
  const [organizing, setOrganizing] = useState(false)
  const [organizeResult, setOrganizeResult] = useState<any>(null)
  const [showOrganizeModal, setShowOrganizeModal] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<Partial<Resource>>({})

  // v2.0: 合并的讲题流式面板
  const [aiStreaming, setAiStreaming] = useState(false)
  const [aiStepContent, setAiStepContent] = useState('')   // 讲题段
  const [aiSolutionContent, setAiSolutionContent] = useState('')  // 标答段
  const [aiError, setAiError] = useState('')
  const aiAbortRef = useRef<AbortController | null>(null)

  // Upload form
  const [form, setForm] = useState({
    title: '',
    content: '',
    subject: '数学',
    knowledge_point: '',
    error_type: 'concept',
    notes: '',
    solution: '',
    thinking: '',
    tags: '',
    difficulty: 3,
    knowledge_tags: '',  // v2.0: 逗号分隔字符串
    file: null as File | null,
  })

  useEffect(() => {
    loadData()
  }, [activeTab, search, filterSubject, filterKnowledgeTag])

  // v2.0: 加载用户所有 knowledge_tags (给下拉)
  useEffect(() => {
    if (activeTab !== 'mistake') return
    listKnowledgeTags()
      .then(d => setAllKnowledgeTags(d.tags || []))
      .catch(e => console.error('listKnowledgeTags:', e))
  }, [activeTab])

  const loadData = async () => {
    try {
      const params: any = { type: activeTab }
      if (filterSubject) params.subject = filterSubject
      if (search) params.search = search
      if (filterKnowledgeTag) params.knowledge_tag = filterKnowledgeTag
      const [list, stat] = await Promise.all([
        listResources(params),
        getResourceStats(),
      ])
      setResources(list.items)
      setStats(stat)
    } catch (e) { console.error(e) }
  }

  const handleUpload = async () => {
    if (!form.title.trim()) {
      alert('请填写标题')
      return
    }
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('type', activeTab)
      formData.append('title', form.title)
      formData.append('content', form.content)
      formData.append('subject', form.subject)
      if (activeTab === 'mistake') {
        formData.append('knowledge_point', form.knowledge_point)
        formData.append('error_type', form.error_type)
        // v2.0: 难度 + 知识点标签 (后端如果没传 tags 会自动 LLM 打标)
        formData.append('difficulty', String(form.difficulty))
        const kt = form.knowledge_tags.split(',').map(t => t.trim()).filter(Boolean)
        formData.append('knowledge_tags', JSON.stringify(kt))
      }
      formData.append('notes', form.notes)
      formData.append('solution', form.solution)
      formData.append('thinking', form.thinking)
      formData.append('tags', JSON.stringify(form.tags.split(',').map(t => t.trim()).filter(Boolean)))
      if (form.file) formData.append('file', form.file)

      const result = await createResource(formData)
      // v2.0: 后端回传了 LLM 自动打的 tags, 提示用户
      const autoTags = result.knowledge_tags?.length ? `, 已自动打标签: ${result.knowledge_tags.join(', ')}` : ''
      alert(`Created ${result.code}! 张老师现在能读到它了${autoTags}`)
      setShowUpload(false)
      setForm({
        title: '', content: '', subject: '数学', knowledge_point: '', error_type: 'concept',
        notes: '', solution: '', thinking: '', tags: '',
        difficulty: 3, knowledge_tags: '', file: null,
      })
      await loadData()
    } catch (e: any) {
      alert('Upload failed: ' + e.message)
    } finally {
      setUploading(false)
    }
  }

  /**
   * v2.0: 合并的"题目讲解"按钮 — 调 POST /api/workspace/mistakes/{id}/explain
   * 一次返回讲题 (4 步) + 标准答案, 流式
   * 完全替代了之前的"张老师讲题"+"一键生成标答"两个按钮
   */
  const handleExplain = async () => {
    if (!selected) return
    if (aiStreaming) {
      aiAbortRef.current?.abort()
    }
    setAiError('')
    setAiStepContent('')
    setAiSolutionContent('')
    setAiStreaming(true)
    const ac = new AbortController()
    aiAbortRef.current = ac
    try {
      for await (const ev of streamExplainMistake(selected.id!, ac.signal)) {
        if (ev.tag === 'STEP') {
          setAiStepContent(s => s + (ev.content || ''))
        } else if (ev.tag === 'SOLUTION') {
          setAiSolutionContent(s => s + (ev.content || ''))
        } else if (ev.tag?.startsWith('STEP_ERROR') || ev.tag?.startsWith('SOLUTION_ERROR')) {
          setAiError((ev.error || '出错了'))
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setAiError(`流式中断: ${e.message}`)
      }
    } finally {
      setAiStreaming(false)
      aiAbortRef.current = null
    }
  }

  const handleStopExplain = () => {
    aiAbortRef.current?.abort()
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this item?')) return
    await deleteResource(id)
    await loadData()
    if (selected?.id === id) setSelected(null)
  }

  const handleMaster = async (id: number) => {
    await markResourceMastered(id)
    await loadData()
    if (selected?.id === id) setSelected({ ...selected, mastered: true })
  }

  const handleView = async (r: Resource) => {
    try {
      const full = await getResource(r.id!)
      setSelected(full)
      setEditForm(full)
      setEditing(false)
      // 重置 AI 面板
      setAiStepContent('')
      setAiSolutionContent('')
      setAiError('')
    } catch (e) { console.error(e) }
  }

  const handleSaveEdit = async () => {
    if (!selected) return
    try {
      const formData = new FormData()
      if (editForm.title) formData.append('title', editForm.title)
      if (editForm.content !== undefined) formData.append('content', editForm.content || '')
      if (editForm.subject !== undefined) formData.append('subject', editForm.subject || '')
      if (editForm.knowledge_point !== undefined) formData.append('knowledge_point', editForm.knowledge_point || '')
      if (editForm.error_type) formData.append('error_type', editForm.error_type)
      // v2.0: 难度 + knowledge_tags
      if (editForm.difficulty !== undefined) formData.append('difficulty', String(editForm.difficulty))
      if (editForm.knowledge_tags !== undefined) {
        formData.append('knowledge_tags', JSON.stringify(editForm.knowledge_tags))
      }
      if (editForm.notes !== undefined) formData.append('notes', editForm.notes || '')
      if (editForm.solution !== undefined) formData.append('solution', editForm.solution || '')
      if (editForm.thinking !== undefined) formData.append('thinking', editForm.thinking || '')
      if (editForm.tags) formData.append('tags', JSON.stringify(editForm.tags))

      await updateResource(selected.id!, formData)
      const full = await getResource(selected.id!)
      setSelected(full)
      setEditForm(full)
      setEditing(false)
      await loadData()
      alert('Updated!')
    } catch (e: any) {
      alert('Update failed: ' + e.message)
    }
  }

  // v0.1.6: 一键整理 — 调 weak-topics 分析薄弱点 + 显示整理报告
  const handleOrganize = async () => {
    if (!stats?.by_type?.mistake) {
      alert('暂无错题可以整理。先添加几个错题吧！')
      return
    }
    setOrganizing(true)
    try {
      const result = await getWeakTopics(1, 10)
      setOrganizeResult(result)
      setShowOrganizeModal(true)
    } catch (e: any) {
      alert('整理失败: ' + (e?.message || '?'))
    } finally {
      setOrganizing(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">资料库</h1>
          <p className="text-sm text-gray-500 mt-1">错题 + 学习资料 · 张老师会读取它们来帮你</p>
        </div>
        <div className="flex gap-2">
          {/* v0.1.6: 一键整理 — 调 weak-topics 自动分析薄弱点 */}
          <button
            onClick={handleOrganize}
            disabled={organizing}
            className="px-4 py-2 bg-white border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50 disabled:opacity-50 flex items-center gap-2"
            title="按知识点 / 学科自动整理错题, 生成薄弱点报告"
          >
            {organizing ? <Loader2 size={18} className="animate-spin" /> : <Package size={18} />}
            <span>一键整理</span>
          </button>
          <button
            onClick={() => setShowUpload(true)}
            className="px-4 py-2 bg-zx-red text-white rounded-lg hover:bg-red-700 flex items-center gap-2"
          >
            <Upload size={18} />
            <span>添加{activeTab === 'mistake' ? '错题' : '资料'}</span>
          </button>
        </div>
      </div>

      {stats && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg shadow-sm">
            <div className="text-sm text-gray-500">总资料</div>
            <div className="text-3xl font-bold text-zx-red mt-1">{stats.total}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm">
            <div className="text-sm text-gray-500">错题</div>
            <div className="text-3xl font-bold text-orange-600 mt-1">{stats.by_type?.mistake || 0}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm">
            <div className="text-sm text-gray-500">学习资料</div>
            <div className="text-3xl font-bold text-blue-600 mt-1">{stats.by_type?.material || 0}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow-sm">
            <div className="text-sm text-gray-500">已掌握</div>
            <div className="text-3xl font-bold text-green-600 mt-1">{stats.mastered || 0}</div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm mb-4">
        <div className="flex border-b">
          <button
            onClick={() => { setActiveTab('mistake'); setFilterKnowledgeTag('') }}
            className={`flex-1 px-4 py-3 text-sm font-medium ${
              activeTab === 'mistake'
                ? 'border-b-2 border-zx-red text-zx-red'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            错题本 ({stats?.by_type?.mistake || 0})
          </button>
          <button
            onClick={() => setActiveTab('material')}
            className={`flex-1 px-4 py-3 text-sm font-medium ${
              activeTab === 'material'
                ? 'border-b-2 border-blue-500 text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            学习资料 ({stats?.by_type?.material || 0})
          </button>
        </div>

        <div className="p-4 flex gap-3 flex-wrap">
          <div className="flex-1 relative min-w-[200px]">
            <Search size={16} className="absolute left-3 top-3 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索标题、内容、知识点、备注..."
              className="w-full pl-9 pr-3 py-2 border rounded-lg focus:outline-none focus:border-zx-red"
            />
          </div>
          <select
            value={filterSubject}
            onChange={(e) => setFilterSubject(e.target.value)}
            className="px-3 py-2 border rounded-lg"
          >
            <option value="">全部学科</option>
            {subjects.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {/* v2.0: 按知识点筛选 (错题 tab 才显示) */}
          {activeTab === 'mistake' && (
            <select
              value={filterKnowledgeTag}
              onChange={(e) => setFilterKnowledgeTag(e.target.value)}
              className="px-3 py-2 border rounded-lg"
              disabled={allKnowledgeTags.length === 0}
            >
              <option value="">全部知识点 ({allKnowledgeTags.length})</option>
              {allKnowledgeTags.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm">
        {resources.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <div className="text-5xl mb-3">{activeTab === 'mistake' ? '错题本' : '资料'}</div>
            <p>还没有{activeTab === 'mistake' ? '错题' : '资料'}，点击右上角添加</p>
          </div>
        ) : (
          <div className="divide-y">
            {resources.map((r) => {
              const errorType = errorTypes.find(t => t.value === r.error_type)
              return (
                <div
                  key={r.id}
                  onClick={() => handleView(r)}
                  className="p-4 hover:bg-gray-50 cursor-pointer"
                >
                  <div className="flex items-start gap-4">
                    {r.file_path ? (
                      r.file_path.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                        <img src={r.file_path} alt="" className="w-16 h-16 object-cover rounded border" />
                      ) : (
                        <div className="w-16 h-16 rounded bg-blue-100 flex items-center justify-center">
                          <FileText size={24} className="text-blue-600" />
                        </div>
                      )
                    ) : (
                      <div className={`w-16 h-16 rounded flex items-center justify-center ${
                        activeTab === 'mistake' ? 'bg-red-100' : 'bg-blue-100'
                      }`}>
                        {activeTab === 'mistake' ?
                          <AlertCircle size={24} className="text-red-600" /> :
                          <BookOpen size={24} className="text-blue-600" />
                        }
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        {r.code && (
                          <span className="px-2 py-0.5 bg-gray-800 text-white text-xs font-mono rounded">
                            {r.code}
                          </span>
                        )}
                        {r.subject && (
                          <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
                            {r.subject}
                          </span>
                        )}
                        {errorType && activeTab === 'mistake' && (
                          <span className={`px-2 py-0.5 text-xs rounded ${errorType.color}`}>
                            {errorType.label}
                          </span>
                        )}
                        {activeTab === 'mistake' && (
                          <DifficultyStars value={r.difficulty} />
                        )}
                        {r.mastered && (
                          <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded flex items-center gap-1">
                            <CheckCircle size={10} />已掌握
                          </span>
                        )}
                        {/* v2.0: knowledge_tags chips — 蓝色, 与 knowledge_point 区分 */}
                        {r.knowledge_tags?.map(t => (
                          <span key={t} className="px-2 py-0.5 bg-cyan-100 text-cyan-700 text-xs rounded">
                            #{t}
                          </span>
                        ))}
                        {r.tags?.map(t => (
                          <span key={t} className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded">
                            #{t}
                          </span>
                        ))}
                      </div>
                      <div className="font-medium text-gray-800">{r.title}</div>
                      {r.knowledge_point && (
                        <div className="text-xs text-gray-500 mt-1">知识点: {r.knowledge_point}</div>
                      )}
                      {r.content && (
                        <div className="text-xs text-gray-500 mt-1 line-clamp-2">{r.content}</div>
                      )}
                      <div className="text-xs text-gray-400 mt-1">
                        {new Date(r.created_at).toLocaleString('zh-CN')}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {activeTab === 'mistake' && !r.mastered && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleMaster(r.id!) }}
                          className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
                        >
                          已掌握
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(r.id!) }}
                        className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-red-100 hover:text-red-600"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Upload modal */}
      {showUpload && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg w-full max-w-md max-h-[90vh] overflow-y-auto p-6">
            {/* v0.1.6: 顶部 sticky 保存条 — 用户随时能看到保存按钮 */}
            <div className="sticky -top-6 -mx-6 px-6 bg-white border-b border-gray-200 pb-3 mb-4 z-10">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold">添加{activeTab === 'mistake' ? '错题' : '学习资料'}</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleUpload}
                    disabled={uploading}
                    className="px-4 py-1.5 bg-zx-red text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-1"
                  >
                    {uploading ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    保存
                  </button>
                  <button onClick={() => setShowUpload(false)} className="p-1.5 hover:bg-gray-100 rounded">
                    <X size={20} />
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-600">标题 *</label>
                <input
                  type="text" value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder={activeTab === 'mistake' ? '例：圆锥曲线焦点弦问题' : '例：高三数学一轮复习笔记'}
                  className="w-full mt-1 border rounded-lg px-3 py-2"
                />
              </div>

              <div>
                <label className="text-sm text-gray-600">学科</label>
                <select
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  className="w-full mt-1 border rounded-lg px-3 py-2"
                >
                  {subjects.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              {activeTab === 'mistake' && (
                <>
                  <div>
                    <label className="text-sm text-gray-600">知识点</label>
                    <input
                      type="text" value={form.knowledge_point}
                      onChange={(e) => setForm({ ...form, knowledge_point: e.target.value })}
                      placeholder="例：圆锥曲线 - 焦点弦"
                      className="w-full mt-1 border rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="text-sm text-gray-600">错误类型</label>
                    <select
                      value={form.error_type}
                      onChange={(e) => setForm({ ...form, error_type: e.target.value })}
                      className="w-full mt-1 border rounded-lg px-3 py-2"
                    >
                      {errorTypes.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  {/* v2.0: 难度 + knowledge_tags */}
                  <div>
                    <label className="text-sm text-gray-600">难度 (1=入门, 5=竞赛)</label>
                    <div className="mt-1 flex items-center gap-2">
                      <DifficultyStars
                        value={form.difficulty}
                        onChange={(v) => setForm({ ...form, difficulty: v })}
                      />
                      <span className="text-xs text-gray-500">{form.difficulty}/5</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-sm text-gray-600">
                      知识标签 (逗号分隔, 留空则 AI 自动打)
                    </label>
                    <input
                      type="text" value={form.knowledge_tags}
                      onChange={(e) => setForm({ ...form, knowledge_tags: e.target.value })}
                      placeholder="如: 二次函数, 顶点公式, 对称轴"
                      className="w-full mt-1 border rounded-lg px-3 py-2"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="text-sm text-gray-600">题目/内容描述</label>
                <textarea value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  placeholder={activeTab === 'mistake' ? '题目内容...' : '资料简介...'}
                  rows={3} className="w-full mt-1 border rounded-lg px-3 py-2" />
              </div>

              {activeTab === 'mistake' && (
                <>
                  <div>
                    <label className="text-sm text-gray-600">解法</label>
                    <textarea value={form.solution}
                      onChange={(e) => setForm({ ...form, solution: e.target.value })}
                      placeholder="这道题的正确解法..."
                      rows={2} className="w-full mt-1 border rounded-lg px-3 py-2" />
                  </div>
                  <div>
                    <label className="text-sm text-gray-600">思路</label>
                    <textarea value={form.thinking}
                      onChange={(e) => setForm({ ...form, thinking: e.target.value })}
                      placeholder="解题思路 / 思维过程..."
                      rows={2} className="w-full mt-1 border rounded-lg px-3 py-2" />
                  </div>
                </>
              )}

              <div>
                <label className="text-sm text-gray-600">备注（任何你想加的）</label>
                <textarea value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="自己的心得、相关知识点..."
                  rows={2} className="w-full mt-1 border rounded-lg px-3 py-2" />
              </div>

              <div>
                <label className="text-sm text-gray-600">标签（逗号分隔）</label>
                <input type="text" value={form.tags}
                  onChange={(e) => setForm({ ...form, tags: e.target.value })}
                  placeholder="如：重点, 高三"
                  className="w-full mt-1 border rounded-lg px-3 py-2" />
              </div>

              <div>
                <label className="text-sm text-gray-600">附件</label>
                <label className="mt-1 flex items-center justify-center border-2 border-dashed rounded-lg p-4 cursor-pointer hover:border-zx-red">
                  <input type="file"
                    onChange={(e) => setForm({ ...form, file: e.target.files?.[0] || null })}
                    className="hidden" />
                  {form.file ? (
                    <span className="text-sm text-gray-600">{form.file.name}</span>
                  ) : (
                    <div className="text-center text-gray-400">
                      <Upload size={20} className="mx-auto mb-1" />
                      <span className="text-xs">点击上传</span>
                    </div>
                  )}
                </label>
              </div>

              <div className="bg-yellow-50 border border-yellow-200 rounded p-2 text-xs text-yellow-700">
                保存后会生成编号（如 M-001），聊天时说"看 M-001"张老师就能找到
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <button onClick={() => setShowUpload(false)} className="flex-1 py-2 border rounded-lg hover:bg-gray-50">取消</button>
              <button onClick={handleUpload} disabled={uploading} className="flex-1 py-2 bg-zx-red text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
                {uploading ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail view modal */}
      {selected && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4 pb-3 border-b">
              <div className="flex items-center gap-2">
                {selected.code && (
                  <span className="px-2 py-1 bg-gray-800 text-white text-sm font-mono rounded">
                    {selected.code}
                  </span>
                )}
                <h3 className="text-lg font-bold">{editing ? '编辑' : ''}{selected.title}</h3>
              </div>
              <div className="flex items-center gap-2">
                {!editing ? (
                  <>
                    {/* v0.1.6: 顶部"保存编辑"按钮 — 滚动到底也能随时点 */}
                    {activeTab === 'mistake' && (
                      <button
                        onClick={() => setEditing(true)}
                        className="px-3 py-1 bg-zx-red text-white text-xs rounded-lg hover:bg-red-700 flex items-center gap-1"
                      >
                        <Edit3 size={12} />编辑
                      </button>
                    )}
                    <button onClick={() => setEditing(true)} className="p-2 hover:bg-gray-100 rounded" title="编辑">
                      <Edit3 size={16} />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleSaveEdit}
                    className="px-3 py-1 bg-zx-red text-white text-xs rounded-lg hover:bg-red-700 flex items-center gap-1"
                  >
                    <Save size={12} />保存
                  </button>
                )}
                <button onClick={() => { setSelected(null); setEditing(false) }}>
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {/* v2.0: 难度 + 知识点标签 chips */}
              <div className="flex flex-wrap gap-1 items-center">
                {selected.subject && <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">{selected.subject}</span>}
                {selected.knowledge_point && <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded">{selected.knowledge_point}</span>}
                {selected.error_type && <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded">{errorTypes.find(t => t.value === selected.error_type)?.label}</span>}
                {selected.type === 'mistake' && (
                  <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-yellow-50 rounded">
                    <span className="text-xs text-gray-600">难度:</span>
                    <DifficultyStars
                      value={editing ? editForm.difficulty : selected.difficulty}
                      onChange={editing ? (v) => setEditForm({ ...editForm, difficulty: v }) : undefined}
                    />
                  </div>
                )}
                {/* v2.0: knowledge_tags chips 优先展示, 老 tags 兜底 */}
                {selected.knowledge_tags?.map(t => (
                  <span key={t} className="px-2 py-0.5 bg-cyan-100 text-cyan-700 text-xs rounded">
                    #{t}
                  </span>
                ))}
                {selected.tags?.map(t => (
                  <span key={t} className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded">#{t}</span>
                ))}
              </div>

              {/* v2.0: 掌握度切换 (错题专属) */}
              {selected.type === 'mistake' && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle size={16} className={selected.mastered ? 'text-green-600' : 'text-gray-400'} />
                    <span className="text-sm font-medium text-gray-700">掌握度</span>
                    <span className="text-xs text-gray-500">
                      {selected.mastered ? '已掌握 — 不会再推类似题' : '未掌握 — Agent 会重点关注'}
                    </span>
                  </div>
                  <label className="inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!selected.mastered}
                      onChange={async (e) => {
                        if (e.target.checked && !selected.mastered) {
                          await handleMaster(selected.id!)
                        }
                        // 已掌握 → 已掌握状态不允许前端取消 (由 Agent 评)
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors relative">
                      <div className={`absolute top-0.5 ${selected.mastered ? 'left-5' : 'left-0.5'} w-5 h-5 bg-white rounded-full transition-all`} />
                    </div>
                  </label>
                </div>
              )}

              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-1">题目/内容</h4>
                {editing ? (
                  <textarea value={editForm.content || ''}
                    onChange={(e) => setEditForm({ ...editForm, content: e.target.value })}
                    rows={4} className="w-full border rounded-lg px-3 py-2" />
                ) : (
                  <div className="text-sm text-gray-800 bg-gray-50 p-3 rounded whitespace-pre-wrap">
                    {selected.content || '(无)'}
                  </div>
                )}
              </div>

              {selected.file_path && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-700 mb-1">附件</h4>
                  {selected.file_path.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                    <img src={selected.file_path} className="max-w-full rounded border" />
                  ) : (
                    <a href={selected.file_path} target="_blank" className="text-blue-600 text-sm underline">
                      {selected.file_path}
                    </a>
                  )}
                </div>
              )}

              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-1">解法</h4>
                {editing ? (
                  <textarea value={editForm.solution || ''}
                    onChange={(e) => setEditForm({ ...editForm, solution: e.target.value })}
                    rows={3} className="w-full border rounded-lg px-3 py-2" placeholder="正确解法..." />
                ) : (
                  <div className="text-sm text-gray-800 bg-green-50 p-3 rounded whitespace-pre-wrap">
                    {selected.solution || '(未填写)'}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-1">思路</h4>
                {editing ? (
                  <textarea value={editForm.thinking || ''}
                    onChange={(e) => setEditForm({ ...editForm, thinking: e.target.value })}
                    rows={3} className="w-full border rounded-lg px-3 py-2" placeholder="解题思路..." />
                ) : (
                  <div className="text-sm text-gray-800 bg-yellow-50 p-3 rounded whitespace-pre-wrap">
                    {selected.thinking || '(未填写)'}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-1">备注</h4>
                {editing ? (
                  <textarea value={editForm.notes || ''}
                    onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                    rows={3} className="w-full border rounded-lg px-3 py-2" placeholder="任何你想加的..." />
                ) : (
                  <div className="text-sm text-gray-800 bg-orange-50 p-3 rounded whitespace-pre-wrap">
                    {selected.notes || '(未填写)'}
                  </div>
                )}
              </div>

              {/* v2.0: 编辑模式下 knowledge_tags 字符串编辑 */}
              {editing && selected.type === 'mistake' && (
                <div>
                  <label className="text-sm text-gray-600">知识标签 (逗号分隔)</label>
                  <input
                    type="text"
                    value={(editForm.knowledge_tags || []).join(', ')}
                    onChange={(e) => setEditForm({
                      ...editForm,
                      knowledge_tags: e.target.value.split(',').map(s => s.trim()).filter(Boolean),
                    })}
                    placeholder="如: 二次函数, 顶点公式"
                    className="w-full mt-1 border rounded-lg px-3 py-2"
                  />
                </div>
              )}

              <div className="text-xs text-gray-400">
                创建于 {new Date(selected.created_at).toLocaleString('zh-CN')}
                {selected.updated_at && selected.updated_at !== selected.created_at && (
                  <> · 更新于 {new Date(selected.updated_at).toLocaleString('zh-CN')}</>
                )}
              </div>
            </div>

            {/* v2.0: 删除按钮移到编辑之外 */}
            {!editing && (
              <div className="flex gap-2 mt-6 pt-4 border-t">
                <button
                  onClick={() => handleDelete(selected.id!)}
                  className="px-4 py-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            )}

            {editing && (
              <div className="flex gap-2 mt-6 pt-4 border-t">
                <button onClick={() => { setEditing(false); setEditForm(selected) }} className="flex-1 py-2 border rounded-lg hover:bg-gray-50">取消</button>
                <button onClick={handleSaveEdit} className="flex-1 py-2 bg-zx-red text-white rounded-lg hover:bg-red-700 flex items-center justify-center gap-2">
                  <Save size={16} />保存
                </button>
              </div>
            )}

            {/* v2.0: 合并的"题目讲解"面板 — 替代旧的"张老师讲题"+"一键生成标答"两个按钮 */}
            {selected.type === 'mistake' && !editing && (
              <div className="mt-4 pt-4 border-t">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles size={16} className="text-purple-600" />
                  <h4 className="text-sm font-semibold text-gray-700">题目讲解</h4>
                  <span className="text-xs text-gray-400">(讲题 4 步 + 标准答案, 一次看完)</span>
                </div>
                <div className="flex gap-2 mb-3 flex-wrap">
                  <button
                    onClick={handleExplain}
                    disabled={aiStreaming}
                    className="px-4 py-2 bg-gradient-to-r from-zx-red to-orange-500 text-white text-sm rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                  >
                    {aiStreaming ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                    题目讲解
                  </button>
                  {aiStreaming && (
                    <button
                      onClick={handleStopExplain}
                      className="px-3 py-1.5 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600"
                    >
                      停止
                    </button>
                  )}
                  {/* 老按钮已删除 — 旧版本有两个按钮: "张老师讲题" + "一键生成标答", 现合并为 1 个 */}
                </div>

                {aiError && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-3 mb-3">
                    {aiError}
                  </div>
                )}

                {/* 讲题段 */}
                {aiStepContent && (
                  <div className="bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200 rounded-lg p-4 mb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <UserCircle2 size={14} className="text-purple-600" />
                      <span className="text-sm font-semibold text-gray-700">张老师讲题</span>
                    </div>
                    <div className="markdown-body text-sm text-gray-800 whitespace-pre-wrap">
                      {aiStepContent}
                      {aiStreaming && !aiSolutionContent && (
                        <span className="inline-block w-2 h-4 bg-purple-400 ml-1 animate-pulse" />
                      )}
                    </div>
                  </div>
                )}

                {/* 标准答案段 */}
                {aiSolutionContent && (
                  <div className="bg-gradient-to-br from-blue-50 to-cyan-50 border border-blue-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles size={14} className="text-blue-600" />
                      <span className="text-sm font-semibold text-gray-700">标准答案</span>
                    </div>
                    <div className="markdown-body text-sm text-gray-800 whitespace-pre-wrap">
                      {aiSolutionContent}
                      {aiStreaming && (
                        <span className="inline-block w-2 h-4 bg-blue-400 ml-1 animate-pulse" />
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* v0.1.6: 一键整理结果 modal */}
      {showOrganizeModal && organizeResult && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4 pb-3 border-b">
              <div className="flex items-center gap-2">
                <Package size={20} className="text-purple-600" />
                <h3 className="text-lg font-bold">一键整理报告</h3>
              </div>
              <button onClick={() => setShowOrganizeModal(false)} className="p-1 hover:bg-gray-100 rounded">
                <X size={20} />
              </button>
            </div>

            {/* 概览 */}
            <div className="grid grid-cols-3 gap-3 mb-5">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div className="text-xs text-blue-700">错题总数</div>
                <div className="text-2xl font-bold text-blue-900 mt-1">{organizeResult.total_mistakes}</div>
              </div>
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                <div className="text-xs text-orange-700">未掌握</div>
                <div className="text-2xl font-bold text-orange-900 mt-1">{organizeResult.unmastered_count}</div>
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                <div className="text-xs text-purple-700">薄弱知识点</div>
                <div className="text-2xl font-bold text-purple-900 mt-1">{organizeResult.weak_topics?.length || 0}</div>
              </div>
            </div>

            {/* 薄弱知识点列表 */}
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-1">
                <ListChecks size={14} />
                优先复习这些知识点 (按错题数排序)
              </h4>
              {organizeResult.weak_topics?.length === 0 ? (
                <div className="text-center text-gray-400 py-8">
                  <CheckCircle size={40} className="mx-auto mb-2 text-green-500" />
                  <div className="text-sm">太棒了! 没有明显薄弱点</div>
                </div>
              ) : (
                <div className="space-y-2">
                  {organizeResult.weak_topics.map((wt: any, i: number) => (
                    <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                        i === 0 ? 'bg-red-500 text-white' :
                        i === 1 ? 'bg-orange-500 text-white' :
                        i === 2 ? 'bg-yellow-500 text-white' :
                        'bg-gray-300 text-gray-700'
                      }`}>
                        {i + 1}
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-gray-800">{wt.topic || wt.knowledge_point || wt.name}</div>
                        {wt.subject && (
                          <div className="text-xs text-gray-500 mt-0.5">学科: {wt.subject}</div>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold text-red-600">{wt.count || wt.mistake_count || 0}</div>
                        <div className="text-xs text-gray-500">错题数</div>
                      </div>
                      <button
                        onClick={() => {
                          setFilterKnowledgeTag(wt.topic || wt.knowledge_point || wt.name || '')
                          setShowOrganizeModal(false)
                        }}
                        className="text-xs px-3 py-1 bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
                      >
                        查看
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 行动建议 */}
            <div className="mt-5 pt-4 border-t">
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-xs text-purple-900 space-y-1">
                <div className="font-medium">建议下一步:</div>
                <div>1. 优先攻克排名 1-3 的薄弱知识点 (点击右侧"查看"跳到列表)</div>
                <div>2. 让 Agent 帮你安排学习计划: 答疑 tab 点 "帮我安排学习计划"</div>
                <div>3. 每天复习 1-2 个, 错题掌握后勾选 ✓ (掌握度)</div>
              </div>
            </div>

            <div className="flex gap-2 mt-5 pt-4 border-t">
              <button
                onClick={() => setShowOrganizeModal(false)}
                className="flex-1 py-2 border rounded-lg hover:bg-gray-50"
              >
                关闭
              </button>
              <button
                onClick={() => {
                  setShowOrganizeModal(false)
                  window.dispatchEvent(new CustomEvent('navigate', { detail: { page: 'chat', tab: 'chat' } }))
                }}
                className="flex-1 py-2 bg-purple-500 text-white rounded-lg hover:bg-purple-600"
              >
                让 Agent 安排计划 →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}