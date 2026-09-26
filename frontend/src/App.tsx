/**
 * App.tsx - v2.0 重做
 *
 * - sidebar 5 个主导航 + 设置
 * - 默认 page = 'today'
 * - main 区按 page 渲染对应组件
 * - page === 'settings' 弹 SettingsModal (行为不变)
 * - sidebar 标题展示 useAgentName
 */
import { useState } from 'react'
import { Sparkles, MessageSquare, Calendar, FolderOpen, User, Settings } from 'lucide-react'
import TodayPage from '@/pages/TodayPage'
import ChatPage from '@/pages/ChatPage'
import SchedulePage from '@/pages/SchedulePage'
import ResourcesPage from '@/pages/ResourcesPage'
import ProfilePage from '@/pages/ProfilePage'
import SettingsModal from '@/components/SettingsModal'
import { useAgentName } from '@/hooks/useAgentName'

type PageKey = 'today' | 'chat' | 'schedule' | 'resources' | 'profile' | 'settings'

interface NavItem {
  key: PageKey
  label: string
  icon: any
  color: string
}

const navItems: NavItem[] = [
  { key: 'today', label: '今日', icon: Sparkles, color: 'text-amber-500' },
  { key: 'chat', label: '会话', icon: MessageSquare, color: 'text-blue-500' },
  { key: 'schedule', label: '日程', icon: Calendar, color: 'text-emerald-500' },
  { key: 'resources', label: '资料库', icon: FolderOpen, color: 'text-indigo-500' },
  { key: 'profile', label: '画像', icon: User, color: 'text-purple-500' },
]

const settingsItem: NavItem = {
  key: 'settings',
  label: '设置',
  icon: Settings,
  color: 'text-orange-500',
}

export default function App() {
  const [page, setPage] = useState<PageKey>('today')
  const [settingsOpen, setSettingsOpen] = useState(false)
  // hook 启动时会自动从 profile 加载 agent_name
  const [agentName] = useAgentName()

  const onNavClick = (key: PageKey) => {
    if (key === 'settings') {
      setSettingsOpen(true)
    } else {
      setSettingsOpen(false)
      setPage(key)
    }
  }

  return (
    <div className="flex h-screen apple-bg relative">
      {/* 苹果风毛玻璃 sidebar */}
      <aside className="w-64 apple-glass-strong flex flex-col z-10">
        <div className="p-6 border-b border-black/5">
          <h1 className="text-lg font-bold tracking-tight">智能体</h1>
          <div className="text-xs text-zinc-500 mt-1">
            当前: {agentName}
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = page === item.key
            return (
              <button
                key={item.key}
                onClick={() => onNavClick(item.key)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
                  isActive
                    ? 'bg-black text-white shadow-md'
                    : 'text-zinc-700 hover:bg-black/5'
                }`}
              >
                <Icon size={18} className={isActive ? '' : item.color} />
                <span>{item.label}</span>
              </button>
            )
          })}

          {/* 分隔线 + 设置 */}
          <div className="my-2 border-t border-black/5" />
          <button
            onClick={() => onNavClick(settingsItem.key)}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all text-sm font-medium ${
              settingsOpen
                ? 'bg-black text-white shadow-md'
                : 'text-zinc-700 hover:bg-black/5'
            }`}
          >
            <settingsItem.icon size={18} className={settingsOpen ? '' : settingsItem.color} />
            <span>设置</span>
          </button>
        </nav>

        <div className="p-4 border-t border-black/5 text-xs text-zinc-500">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span>服务运行中</span>
          </div>
          <div className="mt-1.5 text-zinc-400">v2.0 frontend</div>
        </div>
      </aside>

      <main className="flex-1 overflow-hidden relative z-0">
        {page === 'today' && <TodayPage />}
        {page === 'chat' && <ChatPage />}
        {page === 'schedule' && <SchedulePage />}
        {page === 'resources' && <ResourcesPage />}
        {page === 'profile' && <ProfilePage />}
      </main>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}