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
import { Sparkles, MessageSquare, Calendar, FolderOpen, User, Settings, Gamepad2 } from 'lucide-react'
import TodayPage from '@/pages/TodayPage'
import ChatPage from '@/pages/ChatPage'
import SchedulePage from '@/pages/SchedulePage'
import ResourcesPage from '@/pages/ResourcesPage'
import ProfilePage from '@/pages/ProfilePage'
import GamePage from '@/pages/GamePage'
import SettingsModal from '@/components/SettingsModal'
import { useAgentName } from '@/hooks/useAgentName'

type PageKey = 'today' | 'chat' | 'schedule' | 'resources' | 'profile' | 'game' | 'settings'

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
  // v1.2.2 [P2] 课间解压 — 张雪峰快跑 + 高一必修一背诵, 放在画像和设置之间
  { key: 'game', label: '课间解压', icon: Gamepad2, color: 'text-rose-500' },
]

const settingsItem: NavItem = {
  key: 'settings',
  label: '设置',
  icon: Settings,
  color: 'text-orange-500',
}

export default function App() {
  const [page, setPage] = useState<PageKey>('today')
  // v1.1.10 [P0] visited 集合 — 页面一旦进过就保持 mounted, 切走只 display:none.
  // 原实现 {page === 'chat' && <ChatPage />} 会 unmount ChatPage,
  // 导致 Agent 跑一半切到「资料库」再切回来 → SSE 被 abort, trace/消息全丢.
  const [visited, setVisited] = useState<Set<PageKey>>(() => new Set<PageKey>(['today']))
  const [settingsOpen, setSettingsOpen] = useState(false)
  // hook 启动时会自动从 profile 加载 agent_name
  const [agentName] = useAgentName()

  const go = (p: PageKey) => {
    setPage(p)
    setVisited(prev => {
      if (prev.has(p)) return prev
      const next = new Set(prev)
      next.add(p)
      return next
    })
  }

  const onNavClick = (key: PageKey) => {
    if (key === 'settings') {
      setSettingsOpen(true)
    } else {
      setSettingsOpen(false)
      go(key)
    }
  }

  return (
    <div className="flex h-screen apple-bg relative">
      {/* 苹果风毛玻璃 sidebar */}
      <aside className="w-64 apple-glass-strong flex flex-col z-10">
        <div className="p-6 border-b border-black/5">
          {/* v0.1.6: 主页标题用 useAgentName, 自定义名字全屏统一 */}
          <h1 className="text-lg font-bold tracking-tight">{agentName}</h1>
          <div className="text-xs text-zinc-500 mt-1">
            学业参谋部 · 当前称呼
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
          <div className="mt-1.5 text-zinc-400">学业参谋部 v1.2.2</div>
        </div>
      </aside>

      {/* v1.1.10 [P0] keep-alive 渲染 — visited 过的页面保持 mounted, 切走仅隐藏.
          这样 Agent 跑到一半切到别的页面再切回来, 流还在跑, 消息和 trace 都在. */}
      <main className="flex-1 overflow-hidden relative z-0">
        <div className={page === 'today' ? 'h-full' : 'hidden'}>
          {visited.has('today') && <TodayPage onNavigate={(p) => go(p as PageKey)} />}
        </div>
        <div className={page === 'chat' ? 'h-full' : 'hidden'}>
          {visited.has('chat') && <ChatPage />}
        </div>
        <div className={page === 'schedule' ? 'h-full' : 'hidden'}>
          {visited.has('schedule') && <SchedulePage />}
        </div>
        <div className={page === 'resources' ? 'h-full' : 'hidden'}>
          {visited.has('resources') && <ResourcesPage />}
        </div>
        <div className={page === 'profile' ? 'h-full' : 'hidden'}>
          {visited.has('profile') && <ProfilePage />}
        </div>
        <div className={page === 'game' ? 'h-full' : 'hidden'}>
          {visited.has('game') && <GamePage />}
        </div>
      </main>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}