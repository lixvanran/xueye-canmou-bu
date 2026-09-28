/** SettingsModal - v0.9.1 新增, v2.0 增强
- 替代原 DiagnoseModal
- 4 个 tab: API Key / API 状态 / 模型选择 / 消费
- v2.0: key tab 加 Agent 称呼 文本框, 加 2 个 disabled 占位按钮
*/
import { useState, useEffect, useRef } from 'react'
import {
  Settings, RefreshCw, CheckCircle2, XCircle, AlertTriangle,
  ExternalLink, Copy, X, Zap, ChevronDown, ChevronRight,
  Server, Activity, Wallet, Save, Loader2, Key, Eye, EyeOff, Trash2,
  Mic, Music2, Sparkles, Download, Upload, Database, AlertOctagon, FileJson, AlertCircle
} from 'lucide-react'
import api from '@/api/client'
import { useAgentName } from '@/hooks/useAgentName'

// ===== 类型 =====

interface ModelPing {
  ok: boolean
  status_code?: number
  latency_ms?: number
  model_returned?: string
  tokens?: number
  cost?: number
  error?: string
  error_type?: 'region' | 'payment' | 'not_found' | 'network' | 'unknown'
}

interface TierConfig {
  primary: string
  fallback: string[]
}

interface DiagnoseResult {
  llm_api_key_set: boolean
  llm_api_key_prefix: string | null
  llm_base_url: string
  embedding_provider: string
  search_provider: string
  tts_enabled: boolean
  llm_test?: {
    ok: boolean
    error_code?: number
    error?: string
    diagnosis?: string
    model?: string
    message?: string
    actions?: string[]
    account?: {
      email?: string
      is_free_tier?: boolean
      limit?: number | null
      limit_remaining?: number | null
      usage?: number
      rate_limit?: any
    }
  }
  tier_routing?: {
    low: TierConfig
    medium: TierConfig
    high: TierConfig
    high_trigger_rule?: string
  }
  api_call_status?: {
    pinged_at?: string
    error?: string
    models?: Record<string, ModelPing>
    summary?: { total: number; ok: number; failed: number }
  }
  high_tier_access?: {
    ok?: boolean
    model?: string
    error?: string
    impact?: string
    actions?: string[]
    error_code?: number
  }
}

interface ModelSettings {
  whitelist: Record<'low' | 'medium' | 'high', string[]>
  defaults: Record<'low' | 'medium' | 'high', string>
  current: { low: string; medium: string; high: string }
}

interface UsageInfo {
  ok: boolean
  email?: string
  is_free_tier?: boolean
  limit?: number | null
  limit_remaining?: number | null
  usage?: number | null
  error?: string
}

interface Props {
  inline?: boolean
  onClose?: () => void
}

type Tab = 'key' | 'agent' | 'api' | 'models' | 'usage'

const TIER_LABEL: Record<'low' | 'medium' | 'high', { name: string; color: string; bg: string; border: string }> = {
  low: { name: 'LOW', color: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200' },
  medium: { name: 'MEDIUM', color: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200' },
  high: { name: 'HIGH', color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200' },
}

const TIER_DESC: Record<'low' | 'medium' | 'high', string> = {
  low: '闲聊 / 简单查询 / 1-2 步任务',
  medium: '标准问答 / 多步推理',
  high: '复杂规划 / 深度推理 (需开启 high 模式)',
}


export default function SettingsModal({ inline = false, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('api')

  return (
    <div className={inline ? 'h-full overflow-hidden flex flex-col' : 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4'}>
      <div className={inline
        ? 'flex-1 overflow-hidden flex flex-col'
        : 'bg-white rounded-lg w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col'
      }>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-black/5 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Settings size={20} className="text-orange-500" />
            <h2 className="text-xl font-bold">系统设置</h2>
          </div>
          {!inline && onClose && (
            <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
              <X size={20} />
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b border-black/5 flex-shrink-0 px-5">
          <TabButton active={tab === 'key'} onClick={() => setTab('key')} icon={<Key size={14} />}>
            API Key
          </TabButton>
          {/* v0.1.6: 拆出来的"智能体" tab — Agent 称呼/语音/BGM/数据管理 全在这 */}
          <TabButton active={tab === 'agent'} onClick={() => setTab('agent')} icon={<Sparkles size={14} />}>
            智能体
          </TabButton>
          <TabButton active={tab === 'api'} onClick={() => setTab('api')} icon={<Activity size={14} />}>
            API 状态
          </TabButton>
          <TabButton active={tab === 'models'} onClick={() => setTab('models')} icon={<Server size={14} />}>
            模型设置
          </TabButton>
          <TabButton active={tab === 'usage'} onClick={() => setTab('usage')} icon={<Wallet size={14} />}>
            消费/余额
          </TabButton>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'key' && <ApiKeyTab onKeyUpdated={() => {}} />}
          {tab === 'agent' && <AgentSettingsTab />}
          {tab === 'api' && <ApiStatusTab />}
          {tab === 'models' && <ModelSettingsTab />}
          {tab === 'usage' && <UsageTab />}
        </div>
      </div>
    </div>
  )
}


function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-medium flex items-center gap-1.5 border-b-2 transition-colors ${
        active
          ? 'border-orange-500 text-orange-600'
          : 'border-transparent text-zinc-500 hover:text-zinc-800'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}


// ===== Tab 0: API Key 配置 (v0.1.2 新增, 让用户直接填) =====

function ApiKeyTab({ onKeyUpdated }: { onKeyUpdated: () => void }) {
  const [status, setStatus] = useState<{ is_set: boolean; prefix: string | null } | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [testResult, setTestResult] = useState<any>(null)

  const loadStatus = async () => {
    setLoading(true)
    try {
      const r = await api.get<{ is_set: boolean; prefix: string | null }>('/settings/api-key/status')
      setStatus(r.data)
    } catch (e: any) {
      setMsg({ type: 'err', text: '加载状态失败: ' + (e?.message || '?') })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadStatus() }, [])

  const handleSave = async () => {
    const key = keyInput.trim()
    if (!key) {
      setMsg({ type: 'err', text: '请先填入 key' })
      return
    }
    setSaving(true)
    setMsg(null)
    setTestResult(null)
    try {
      const r = await api.post<{ success: boolean; message: string; prefix: string }>('/settings/api-key', { api_key: key })
      setMsg({ type: 'ok', text: `✓ ${r.data.message}` })
      setKeyInput('')
      setShowKey(false)
      loadStatus()
      onKeyUpdated()
    } catch (e: any) {
      const detail = e?.response?.data?.detail || e?.message || '?'
      setMsg({ type: 'err', text: `保存失败: ${detail}` })
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    const key = keyInput.trim() || (status?.prefix ? '' : '')  // 测当前输入框的值
    if (!key) {
      setMsg({ type: 'err', text: '请先填入 key 再测试' })
      return
    }
    setTesting(true)
    setMsg(null)
    setTestResult(null)
    try {
      const r = await api.post<any>('/settings/api-key/test', { api_key: key })
      setTestResult(r.data)
      if (r.data.ok) {
        setMsg({ type: 'ok', text: '✓ Key 有效 (OpenRouter 认证通过)' })
      } else {
        setMsg({ type: 'err', text: `✗ Key 无效: ${r.data.error || '?'}` })
      }
    } catch (e: any) {
      const detail = e?.response?.data?.detail || e?.message || '?'
      setMsg({ type: 'err', text: `测试失败: ${detail}` })
    } finally {
      setTesting(false)
    }
  }

  const handleClear = async () => {
    if (!confirm('确定要清空 API Key? \n下次启动服务后所有 LLM 调用将失败, 需要重新填。')) return
    setLoading(true)
    try {
      await api.delete('/settings/api-key')
      setMsg({ type: 'ok', text: '✓ Key 已清空 (需重启服务生效)' })
      loadStatus()
    } catch (e: any) {
      setMsg({ type: 'err', text: '清空失败: ' + (e?.message || '?') })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* 当前状态 */}
      <div className={`rounded-lg p-4 border ${
        status?.is_set ? 'bg-green-50 border-green-200' : 'bg-orange-50 border-orange-200'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {loading ? (
              <Loader2 size={16} className="animate-spin text-gray-400" />
            ) : status?.is_set ? (
              <CheckCircle2 size={20} className="text-green-600" />
            ) : (
              <AlertTriangle size={20} className="text-orange-500" />
            )}
            <div>
              <div className="font-semibold text-sm">
                {status?.is_set ? 'API Key 已设置' : 'API Key 未设置'}
              </div>
              {status?.is_set && status.prefix && (
                <div className="text-xs text-gray-600 mt-0.5 font-mono">
                  当前: {status.prefix}
                </div>
              )}
            </div>
          </div>
          {status?.is_set && (
            <button
              onClick={handleClear}
              disabled={loading}
              className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded flex items-center gap-1"
            >
              <Trash2 size={12} /> 清空
            </button>
          )}
        </div>
      </div>

      {/* 输入区 */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {status?.is_set ? '更换 Key (新值)' : '填入 OpenRouter API Key'}
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type={showKey ? 'text' : 'password'}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-md font-mono text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              disabled={saving}
              onKeyDown={(e) => { if (e.key === 'Enter') handleTest() }}
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              tabIndex={-1}
            >
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          <ExternalLink size={11} className="inline" /> 去{' '}
          <a
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noreferrer"
            className="text-purple-600 hover:underline"
          >
            openrouter.ai/keys
          </a>{' '}
          申请 → 一把 Key 调 Claude / GPT / Qwen / DeepSeek 等
        </p>

        <div className="flex gap-2 mt-3">
          <button
            onClick={handleTest}
            disabled={testing || !keyInput.trim()}
            className="px-4 py-2 text-sm bg-white border border-purple-300 text-purple-700 rounded-md hover:bg-purple-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
          >
            {testing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            测试 Key
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !keyInput.trim()}
            className="px-4 py-2 text-sm bg-purple-500 text-white rounded-md hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            保存到 .env
          </button>
        </div>
      </div>

      {/* 提示消息 */}
      {msg && (
        <div className={`rounded-lg p-3 border text-sm ${
          msg.type === 'ok'
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {msg.text}
        </div>
      )}

      {/* 测试结果 */}
      {testResult && testResult.ok && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm space-y-1">
          <div className="font-semibold text-green-800 flex items-center gap-1">
            <CheckCircle2 size={14} /> OpenRouter 账户信息
          </div>
          {testResult.email && (
            <div className="text-gray-700">📧 邮箱: <span className="font-mono">{testResult.email}</span></div>
          )}
          {testResult.is_free_tier !== undefined && (
            <div className="text-gray-700">
              🎁 套餐: {testResult.is_free_tier ? '免费档' : '付费档'}
            </div>
          )}
          {testResult.limit !== null && (
            <div className="text-gray-700">
              💰 总额度: ${testResult.limit?.toFixed(2) || '0'} | 剩余: ${testResult.limit_remaining?.toFixed(2) || '0'} | 已用: ${testResult.usage?.toFixed(2) || '0'}
            </div>
          )}
        </div>
      )}

      {/* 流程说明 */}
      <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 space-y-1">
        <div className="font-medium text-gray-700">📋 使用流程</div>
        <div>1. 申请 OpenRouter Key (上面链接)</div>
        <div>2. 在输入框粘贴 → 点「测试 Key」验证 → 看账户信息</div>
        <div>3. 点「保存到 .env」写入 <span className="font-mono">backend/.env</span></div>
        <div>4. <span className="text-orange-600 font-medium">重启服务 (双击 启动.bat) 生效</span></div>
      </div>
    </div>
  )
}


// ===== v0.1.6: Tab "智能体" — Agent 称呼 / 个性化 / 数据管理 (从 API Key tab 拆出来) =====

function AgentSettingsTab() {
  const [agentName, setAgentName, reloadAgentName] = useAgentName()
  const [agentNameInput, setAgentNameInput] = useState(agentName)
  const [agentNameSaving, setAgentNameSaving] = useState(false)
  const [agentNameMsg, setAgentNameMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    setAgentNameInput(agentName)
  }, [agentName])

  const handleSaveAgentName = async () => {
    setAgentNameSaving(true)
    setAgentNameMsg(null)
    try {
      await setAgentName(agentNameInput)
      await reloadAgentName()
      setAgentNameMsg({ type: 'ok', text: `已保存: ${agentNameInput.trim() || '张老师'} (侧边栏 + 主页 + Agent 自我介绍都会用这个)` })
      setTimeout(() => setAgentNameMsg(null), 3000)
    } catch (e: any) {
      const detail = e?.response?.data?.detail || e?.message || '保存失败'
      setAgentNameMsg({ type: 'err', text: `保存失败: ${detail}` })
    } finally {
      setAgentNameSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* v0.1.6: Agent 称呼 */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
          <Sparkles size={14} className="text-amber-500" />
          Agent 称呼
          <span className="text-xs text-gray-400 font-normal">(侧边栏标题 + 主页 + 自我介绍统一用这个)</span>
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={agentNameInput}
            onChange={(e) => setAgentNameInput(e.target.value)}
            placeholder="张老师"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            disabled={agentNameSaving}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSaveAgentName() }}
          />
          <button
            onClick={handleSaveAgentName}
            disabled={agentNameSaving}
            className="px-4 py-2 text-sm bg-amber-500 text-white rounded-md hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
          >
            {agentNameSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            保存
          </button>
        </div>
        {agentNameMsg && (
          <div
            className={`mt-2 rounded-md p-2 text-sm border ${
              agentNameMsg.type === 'ok'
                ? 'bg-green-50 border-green-200 text-green-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            {agentNameMsg.text}
          </div>
        )}
      </div>

      {/* v0.1.6: 2 个 disabled 占位按钮 (个性化) */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
        <div className="text-sm font-medium text-gray-700 mb-2">个性化 (即将推出)</div>
        <div className="flex flex-wrap gap-2">
          <button
            disabled
            title="即将推出"
            className="opacity-50 cursor-not-allowed inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-md border border-gray-200"
          >
            <Mic size={12} />
            上传语音样本 (.wav)
          </button>
          <button
            disabled
            title="即将推出"
            className="opacity-50 cursor-not-allowed inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded-md border border-gray-200"
          >
            <Music2 size={12} />
            选择背景音乐
          </button>
        </div>
      </div>

      {/* v0.1.6: 数据管理 — 导出 / 导入 (从 API Key tab 移到这里) */}
      <DataManagementSection />
    </div>
  )
}


// ===== v2.0: 数据管理 (导出 / 导入) =====
function DataManagementSection() {
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null)
  const [exportMeta, setExportMeta] = useState<{ filename: string; bytes: number } | null>(null)

  const [importMode, setImportMode] = useState<'merge' | 'overwrite'>('merge')
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState<{ type: 'ok' | 'err'; text: string; counts?: Record<string, number> } | null>(null)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleExport = async () => {
    setExporting(true)
    setExportMsg(null)
    setExportMeta(null)
    try {
      const r = await fetch('/api/user/export?user_id=1')
      if (!r.ok) {
        const text = await r.text().catch(() => '')
        throw new Error(`HTTP ${r.status} ${text || ''}`.trim())
      }
      const data = await r.json()
      const jsonStr = JSON.stringify(data, null, 2)
      const blob = new Blob([jsonStr], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      const date = new Date()
      const y = date.getFullYear()
      const m = String(date.getMonth() + 1).padStart(2, '0')
      const d = String(date.getDate()).padStart(2, '0')
      const filename = `localagent-export-${y}-${m}-${d}.json`
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setExportMeta({ filename, bytes: blob.size })
      setExportMsg({
        type: 'ok',
        text: `已导出 ${filename} (${(blob.size / 1024).toFixed(1)} KB)`,
      })
      setTimeout(() => setExportMsg(null), 4000)
    } catch (e: any) {
      setExportMsg({ type: 'err', text: `导出失败: ${e?.message || '?'}` })
    } finally {
      setExporting(false)
    }
  }

  const handlePickFile = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setPendingFile(f)
    setImportMsg(null)
    // 选完文件自动触发预览 (读 JSON), 让用户看到内容再决定是否导入
    void runImport(f, importMode, false)
  }

  const runImport = async (file: File, mode: 'merge' | 'overwrite', confirmed: boolean) => {
    if (mode === 'overwrite' && !confirmed) {
      if (!confirm(
        `确定要以「覆盖」模式导入?\n\n` +
        `覆盖会清空现有 profile / conversations / facts / resources / schedules, 再从文件恢复。\n` +
        `建议先用「合并」模式导入试试效果, 再决定是否覆盖。\n\n` +
        `继续覆盖导入?`
      )) {
        return
      }
    }
    setImporting(true)
    setImportMsg(null)
    try {
      const text = await file.text()
      let payload: any
      try {
        payload = JSON.parse(text)
      } catch (parseErr: any) {
        throw new Error(`JSON 解析失败: ${parseErr?.message || parseErr}`)
      }
      if (!payload || typeof payload !== 'object') {
        throw new Error('JSON 顶层必须是对象')
      }
      const r = await fetch(`/api/user/import?user_id=1&mode=${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!r.ok) {
        const errText = await r.text().catch(() => '')
        let detail = errText
        try {
          const j = JSON.parse(errText)
          detail = j.detail || j.message || errText
        } catch { /* keep errText */ }
        throw new Error(`HTTP ${r.status}: ${detail || '?'}`)
      }
      const data = await r.json()
      const counts = data.imported || {}
      setImportMsg({
        type: 'ok',
        text: `导入完成 (mode=${mode}) · ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(', ')}`,
        counts,
      })
      setPendingFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setTimeout(() => setImportMsg(null), 6000)
    } catch (e: any) {
      setImportMsg({ type: 'err', text: `导入失败: ${e?.message || '?'}` })
    } finally {
      setImporting(false)
    }
  }

  const handleConfirmImport = () => {
    if (!pendingFile) {
      handlePickFile()
      return
    }
    void runImport(pendingFile, importMode, true)
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Database size={14} className="text-indigo-500" />
        <div className="text-sm font-medium text-gray-700">数据管理</div>
        <span className="text-xs text-gray-400">导出 / 导入 (JSON)</span>
      </div>

      {/* 导出 */}
      <div className="border border-black/5 rounded-md p-3 bg-zinc-50/40">
        <div className="flex items-center gap-2 mb-2">
          <FileJson size={13} className="text-blue-600" />
          <div className="text-xs font-medium text-gray-700">导出我的数据</div>
        </div>
        <p className="text-xs text-gray-500 mb-2">
          把 profile / conversations / facts / resources / schedules 一并打包为 JSON, 浏览器自动下载。
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-500 text-white rounded-md hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            {exporting ? '导出中...' : '导出我的数据'}
          </button>
          {exportMeta && (
            <span className="text-xs text-gray-500 font-mono">
              {exportMeta.filename} · {exportMeta.bytes.toLocaleString()} bytes
            </span>
          )}
        </div>
        {exportMsg && (
          <div className={`mt-2 rounded-md p-2 text-xs border flex items-start gap-1.5 ${
            exportMsg.type === 'ok'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}>
            {exportMsg.type === 'ok' ? <CheckCircle2 size={12} className="flex-shrink-0 mt-0.5" /> : <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />}
            <span>{exportMsg.text}</span>
          </div>
        )}
      </div>

      {/* 导入 */}
      <div className="border border-black/5 rounded-md p-3 bg-zinc-50/40">
        <div className="flex items-center gap-2 mb-2">
          <Upload size={13} className="text-emerald-600" />
          <div className="text-xs font-medium text-gray-700">导入数据</div>
        </div>
        <p className="text-xs text-gray-500 mb-2">
          选一个之前导出的 JSON 文件, 把数据恢复到当前用户。
        </p>

        {/* 模式选择 */}
        <div className="mb-2 flex items-center gap-3 text-xs">
          <span className="text-gray-600">模式:</span>
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name="import-mode"
              value="merge"
              checked={importMode === 'merge'}
              onChange={() => setImportMode('merge')}
              className="text-emerald-500 focus:ring-emerald-500"
            />
            <span>合并 (默认)</span>
          </label>
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name="import-mode"
              value="overwrite"
              checked={importMode === 'overwrite'}
              onChange={() => setImportMode('overwrite')}
              className="text-red-500 focus:ring-red-500"
            />
            <span className={importMode === 'overwrite' ? 'text-red-600 font-medium' : ''}>覆盖</span>
          </label>
          {importMode === 'overwrite' && (
            <span className="inline-flex items-center gap-1 text-xs text-red-600">
              <AlertOctagon size={11} />
              会清空现有数据
            </span>
          )}
        </div>

        {/* 文件选择 + 隐藏 file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={handleFileChange}
          className="hidden"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handlePickFile}
            disabled={importing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-emerald-300 text-emerald-700 rounded-md hover:bg-emerald-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {pendingFile ? '重选文件' : '选择 JSON 文件'}
          </button>
          {pendingFile && (
            <>
              <span className="text-xs text-gray-600 font-mono truncate max-w-[14rem]" title={pendingFile.name}>
                {pendingFile.name} · {(pendingFile.size / 1024).toFixed(1)} KB
              </span>
              <button
                onClick={handleConfirmImport}
                disabled={importing}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed ${
                  importMode === 'overwrite'
                    ? 'bg-red-500 hover:bg-red-600'
                    : 'bg-emerald-500 hover:bg-emerald-600'
                }`}
              >
                {importing ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                确认导入 ({importMode})
              </button>
            </>
          )}
        </div>
        {importMsg && (
          <div className={`mt-2 rounded-md p-2 text-xs border ${
            importMsg.type === 'ok'
              ? 'bg-green-50 border-green-200 text-green-800'
              : 'bg-red-50 border-red-200 text-red-800'
          }`}>
            <div className="flex items-start gap-1.5">
              {importMsg.type === 'ok' ? <CheckCircle2 size={12} className="flex-shrink-0 mt-0.5" /> : <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />}
              <div>
                <div>{importMsg.text}</div>
                {importMsg.counts && (
                  <div className="text-xs mt-1 font-mono opacity-70">
                    {JSON.stringify(importMsg.counts)}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* v0.1.7+: 一键清空测试数据 (清会话 + 错题 + 计划 + 事实 + workspace/uploads/) */}
      <ResetTestDataSection />
    </div>
  )
}


// v0.1.7+: 重置测试数据 — POST /api/workspace/reset-test-data
function ResetTestDataSection() {
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{type: 'ok'|'err'; text: string; counts?: any} | null>(null)

  const handleReset = async () => {
    if (!confirm('确定清空所有 Agent 留下的测试数据?\n\n会清空:\n- 所有会话和消息\n- 所有错题和学习资料记录\n- 所有学习计划和事实\n- workspace/uploads/ 里的桌面拖入文件\n\n会保留:\n- 用户基本资料 (persona, agent_name 等)\n- 设置 (API Key 等)'))
    if (!confirm('再次确认 — 这个操作不可撤销!')) return
    setLoading(true)
    setMsg(null)
    try {
      const resp = await fetch('/api/workspace/reset-test-data', { method: 'POST' })
      const data = await resp.json()
      if (data.success) {
        setMsg({ type: 'ok', text: '已清空', counts: data.cleared })
      } else {
        setMsg({ type: 'err', text: data.error || '清空失败' })
      }
    } catch (e: any) {
      setMsg({ type: 'err', text: `请求失败: ${e.message || e}` })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="border border-red-200 rounded-md p-3 bg-red-50/40">
      <div className="flex items-center gap-2 mb-2">
        <Trash2 size={13} className="text-red-600" />
        <div className="text-xs font-medium text-red-700">一键清空测试数据</div>
        <span className="text-xs text-red-400">(应急)</span>
      </div>
      <p className="text-xs text-gray-500 mb-2">
        清空所有 Agent 跑测试留下的会话、错题、学习计划、事实、桌面拖入的文件。保留用户资料和设置。
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={handleReset}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-500 text-white rounded-md hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          {loading ? '清空中...' : '一键清空测试数据'}
        </button>
      </div>
      {msg && (
        <div className={`mt-2 rounded-md p-2 text-xs border ${
          msg.type === 'ok'
            ? 'bg-green-50 border-green-200 text-green-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          <div className="flex items-start gap-1.5">
            {msg.type === 'ok' ? <CheckCircle2 size={12} className="flex-shrink-0 mt-0.5" /> : <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />}
            <div>
              <div>{msg.text}</div>
              {msg.counts && (
                <div className="text-xs mt-1 font-mono opacity-70">
                  {JSON.stringify(msg.counts)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// ===== Tab 1: API 状态 (原 DiagnoseModal 主体) =====

function ApiStatusTab() {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<DiagnoseResult | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const run = async () => {
    setLoading(true)
    setErr(null)
    try {
      const r = await api.get<DiagnoseResult>('/diagnose', { timeout: 60000 })
      setResult(r.data)
    } catch (e: any) {
      setErr(e?.message || '请求失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (!result) run() }, [])

  if (loading && !result) {
    return (
      <div className="flex items-center gap-2 text-gray-500 py-8 justify-center">
        <RefreshCw size={20} className="animate-spin" />
        正在检测 OpenRouter key + ping 所有 3 档模型...
        <span className="text-xs ml-2">(最多 60s)</span>
      </div>
    )
  }

  if (err) {
    return (
      <div className="space-y-3">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-2">
          <XCircle size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-medium text-red-800">检测请求失败</div>
            <div className="text-sm text-red-600 mt-1">{err}</div>
          </div>
        </div>
        <button onClick={run} className="px-3 py-1.5 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 flex items-center gap-1">
          <RefreshCw size={14} /> 重试
        </button>
      </div>
    )
  }

  if (!result) return null

  return (
    <div className="space-y-4">
      {/* 总状态 */}
      <div className={`rounded-lg p-4 flex items-start gap-3 ${
        result.llm_test?.ok ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
      }`}>
        {result.llm_test?.ok ? (
          <CheckCircle2 size={24} className="text-green-500 flex-shrink-0" />
        ) : (
          <XCircle size={24} className="text-red-500 flex-shrink-0" />
        )}
        <div className="flex-1">
          <div className="font-semibold">
            {result.llm_test?.ok ? '✓ OpenRouter key 有效' : '✗ key 验证失败'}
          </div>
          {result.llm_test?.message && (
            <div className="text-sm text-zinc-600 mt-1">{result.llm_test.message}</div>
          )}
          {result.llm_test?.error && (
            <div className="text-sm text-red-600 mt-1">{result.llm_test.error}</div>
          )}
          {result.llm_test?.account && (
            <div className="text-sm text-zinc-600 mt-1">
              {result.llm_test.account.email && <span>账号: {result.llm_test.account.email} · </span>}
              {result.llm_test.account.is_free_tier !== undefined && (
                <span>{result.llm_test.account.is_free_tier ? '免费版' : '付费版'}</span>
              )}
            </div>
          )}
        </div>
        <button onClick={run} disabled={loading} className="px-3 py-1.5 text-xs bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 flex items-center gap-1">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> 重新检测
        </button>
      </div>

      {/* 失败时的解决步骤 */}
      {!result.llm_test?.ok && result.llm_test?.actions && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="font-medium text-amber-800 flex items-center gap-1 mb-2">
            <AlertTriangle size={16} /> 解决步骤
          </div>
          <ol className="text-sm text-amber-900 space-y-1 list-decimal list-inside">
            {result.llm_test.actions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ol>
        </div>
      )}

      {/* 基础信息 */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <InfoRow label="LLM Base URL" value={result.llm_base_url} />
        <InfoRow label="Embedding" value={result.embedding_provider} />
        <InfoRow label="Search" value={result.search_provider} />
        <InfoRow label="TTS" value={result.tts_enabled ? '已启用' : '未启用'} />
        <InfoRow label="API Key" value={result.llm_api_key_prefix || '未设置'} />
      </div>

      {/* 三档配置 */}
      {result.tier_routing && (
        <div className="space-y-2">
          <div className="text-sm font-semibold text-zinc-700 flex items-center gap-1">
            <Zap size={14} /> 三档模型配置
          </div>
          {(['low', 'medium', 'high'] as const).map(tier => {
            const t = result.tier_routing![tier]
            const label = TIER_LABEL[tier]
            return (
              <div key={tier} className={`rounded-lg border p-3 ${label.border} ${label.bg}`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`text-xs font-bold ${label.color}`}>{label.name}</span>
                  <span className="text-xs text-zinc-500">{tier}</span>
                </div>
                <div className="text-sm font-mono text-zinc-800">{t.primary}</div>
                {t.fallback && t.fallback.length > 0 && (
                  <div className="text-xs text-zinc-500 mt-1">
                    fallback: {t.fallback.join(', ')}
                  </div>
                )}
              </div>
            )
          })}
          {result.tier_routing.high_trigger_rule && (
            <div className="text-xs text-zinc-500 mt-2">
              触发规则: {result.tier_routing.high_trigger_rule}
            </div>
          )}
        </div>
      )}
    </div>
  )
}


function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-zinc-50 rounded-lg px-3 py-2">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="text-sm font-mono text-zinc-800 mt-0.5 truncate" title={value}>{value}</div>
    </div>
  )
}


// ===== Tab 2: 模型选择 =====

function ModelSettingsTab() {
  const [settings, setSettings] = useState<ModelSettings | null>(null)
  const [selection, setSelection] = useState<{ low: string; medium: string; high: string }>({ low: '', medium: '', high: '' })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setErr(null)
    try {
      const r = await api.get<ModelSettings>('/settings/models')
      setSettings(r.data)
      setSelection(r.data.current)
    } catch (e: any) {
      setErr(e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const save = async () => {
    setSaving(true)
    setErr(null)
    setMsg(null)
    try {
      await api.put('/settings/models', selection)
      setMsg('✓ 已保存, 下次对话生效')
      setTimeout(() => setMsg(null), 3000)
    } catch (e: any) {
      const errMsg = e?.response?.data?.detail || e?.message || '保存失败'
      setErr(errMsg)
    } finally {
      setSaving(false)
    }
  }

  if (loading && !settings) {
    return (
      <div className="flex items-center gap-2 text-gray-500 py-8 justify-center">
        <Loader2 size={20} className="animate-spin" /> 加载模型设置...
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="text-red-600">加载失败: {err}</div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="text-sm text-zinc-600 bg-blue-50 border border-blue-200 rounded-lg p-3">
        💡 从每档白名单里选一个模型。<br />
        严格白名单: 只能调用下列模型, 不会乱跑别的。<br />
        默认: low=minimaxM2.7, medium/high=minimaxM3
      </div>

      {(['low', 'medium', 'high'] as const).map(tier => {
        const opts = settings.whitelist[tier] || []
        const defaultModel = settings.defaults[tier]
        const current = selection[tier]
        return (
          <div key={tier} className={`rounded-lg border p-4 ${TIER_LABEL[tier].border} ${TIER_LABEL[tier].bg}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-sm font-bold ${TIER_LABEL[tier].color}`}>{TIER_LABEL[tier].name}</span>
              <span className="text-xs text-zinc-500">{TIER_DESC[tier]}</span>
            </div>
            <div className="space-y-1.5">
              {opts.map(model => (
                <label key={model} className="flex items-center gap-2 cursor-pointer hover:bg-white/60 rounded px-2 py-1.5 -mx-2">
                  <input
                    type="radio"
                    name={`tier-${tier}`}
                    value={model}
                    checked={current === model}
                    onChange={() => setSelection(prev => ({ ...prev, [tier]: model }))}
                    className="text-orange-500 focus:ring-orange-500"
                  />
                  <span className="text-sm font-mono flex-1 text-zinc-800">{model}</span>
                  {model === defaultModel && (
                    <span className="text-xs px-1.5 py-0.5 bg-white/80 text-zinc-600 rounded">默认</span>
                  )}
                </label>
              ))}
            </div>
          </div>
        )
      })}

      {err && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 flex items-start gap-2">
          <XCircle size={16} className="flex-shrink-0 mt-0.5" />
          <div>{err}</div>
        </div>
      )}

      {msg && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 flex items-center gap-2">
          <CheckCircle2 size={16} />
          {msg}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 flex items-center gap-1.5"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          {saving ? '保存中...' : '保存设置'}
        </button>
        <button
          onClick={load}
          disabled={loading}
          className="px-4 py-2 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 flex items-center gap-1.5"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 重新加载
        </button>
      </div>
    </div>
  )
}


// ===== Tab 3: 消费/余额 =====

function UsageTab() {
  const [usage, setUsage] = useState<UsageInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setErr(null)
    try {
      const r = await api.get<UsageInfo>('/settings/usage')
      setUsage(r.data)
    } catch (e: any) {
      setErr(e?.message || '查询失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading && !usage) {
    return (
      <div className="flex items-center gap-2 text-gray-500 py-8 justify-center">
        <Loader2 size={20} className="animate-spin" /> 查询 OpenRouter 余额...
      </div>
    )
  }

  if (err && !usage) {
    return (
      <div className="space-y-3">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">{err}</div>
        <button onClick={load} className="px-3 py-1.5 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 flex items-center gap-1">
          <RefreshCw size={14} /> 重试
        </button>
      </div>
    )
  }

  if (!usage) return null

  if (!usage.ok) {
    return (
      <div className="space-y-3">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="font-medium text-amber-800 flex items-center gap-1 mb-1">
            <AlertTriangle size={16} /> 无法查询余额
          </div>
          <div className="text-sm text-amber-700">{usage.error}</div>
        </div>
        <button onClick={load} className="px-3 py-1.5 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 flex items-center gap-1">
          <RefreshCw size={14} /> 重试
        </button>
      </div>
    )
  }

  const limit = usage.limit
  const remaining = usage.limit_remaining
  const used = usage.usage
  const pct = limit && limit > 0 && remaining != null
    ? Math.round(((limit - remaining) / limit) * 100)
    : null

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-green-200 bg-green-50 p-5">
        <div className="text-sm text-zinc-600 mb-1">OpenRouter 账号</div>
        <div className="text-2xl font-bold text-zinc-800 mb-1">{usage.email || '(匿名)'}</div>
        <div className="text-xs text-zinc-500">
          {usage.is_free_tier ? '免费版' : '付费版'} ·
          <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer" className="ml-1 text-orange-600 hover:underline inline-flex items-center gap-0.5">
            管理 key <ExternalLink size={10} />
          </a>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card label="总额度" value={limit != null ? `$${limit.toFixed(2)}` : '-'} />
        <Card label="已用" value={used != null ? `$${used.toFixed(2)}` : '-'} color="text-amber-600" />
        <Card label="剩余" value={remaining != null ? `$${remaining.toFixed(2)}` : '-'} color="text-green-600" />
      </div>

      {pct != null && limit != null && (
        <div className="bg-zinc-50 rounded-lg p-4">
          <div className="text-sm text-zinc-600 mb-2">使用进度</div>
          <div className="w-full bg-zinc-200 rounded-full h-3 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-amber-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
          <div className="text-xs text-zinc-500 mt-2 text-right">{pct}%</div>
        </div>
      )}

      <div className="text-xs text-zinc-500">
        💡 数据来自 OpenRouter <code className="px-1 bg-zinc-100 rounded">/api/v1/auth/key</code>, 不消耗 token。
      </div>

      <button
        onClick={load}
        disabled={loading}
        className="px-3 py-1.5 text-sm bg-white border border-zinc-200 rounded-lg hover:bg-zinc-50 flex items-center gap-1"
      >
        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> 刷新
      </button>
    </div>
  )
}


function Card({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-zinc-50 rounded-lg p-4">
      <div className="text-xs text-zinc-500 mb-1">{label}</div>
      <div className={`text-xl font-bold ${color || 'text-zinc-800'}`}>{value}</div>
    </div>
  )
}
