/**
 * GamePage — v1.2.2 课间解压
 *
 * 嵌入 zxf_running (张雪峰快跑) 的修改版:
 *   - 保留原游戏所有元素: 巧乐兹/雪碧瓶/跑步机/跳跃/下蹲
 *   - 新增「高一必修一背诵」知识点卡片, 玩家跳跃碰到 → +50 飘字
 *   - 不伤害玩家, 不替换原障碍物, 完全只加不减
 *
 * 用 iframe 加载, 这样原游戏的 window/document/canvas 上下文独立,
 * 不会跟我们 React 主路由 / sidebar 冲突, 切页时游戏状态保留 (因为 iframe 不卸载).
 *
 * 跨域/样式问题:
 *   - iframe 同源 (public/games/zxf_running/), 所以 postMessage 通信可行
 *   - 不需要通信, 只展示
 */
import { useEffect, useRef, useState } from 'react'
import { Gamepad2, BookOpen, ChevronRight, RefreshCw, Maximize2, Info } from 'lucide-react'

const GAME_URL = '/games/zxf_running/index.html'

export default function GamePage() {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [iframeKey, setIframeKey] = useState(0)
  const [tipOpen, setTipOpen] = useState(false)
  // 知识点 + 原游戏 提示
  const TIPS = [
    { icon: '🚀', title: '跳跃', text: '按 Space / ↑ 跳过地面障碍（巧乐兹）' },
    { icon: '⬇️', title: '下蹲', text: '按 ↓ 蹲过空中障碍（雪碧瓶）' },
    { icon: '📚', title: '背诵', text: '天上飘的卡片 = 高一必修一知识点，跳起来碰到即可加分（不碰不扣血）' },
    { icon: '⚡', title: '速度', text: '分数越高，跑步机越快，障碍越密（知识点仍稀疏，不会冲突）' },
  ]

  const reload = () => setIframeKey(k => k + 1)

  const fullscreen = () => {
    const el = iframeRef.current
    if (!el) return
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      el.requestFullscreen?.().catch(() => {})
    }
  }

  // 键盘拦截 (iframe 焦点自己处理, 这里只提示快捷键)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // F5 / Cmd-R 防止父路由 reload — 让游戏 iframe 自己处理
      if (e.key === 'F5') {
        e.preventDefault()
        reload()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="h-full overflow-auto apple-bg">
      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Gamepad2 className="text-rose-500" size={24} />
              课间解压
            </h1>
            <p className="text-sm text-zinc-500 mt-1.5 flex items-center gap-3">
              <span>张雪峰快跑 · 高一必修一背诵版</span>
              <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                课间 5 分钟，刷一道题
              </span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTipOpen(o => !o)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-black/10 rounded-full text-xs text-zinc-700 hover:bg-zinc-50"
              title="玩法说明"
            >
              <Info size={13} />
              玩法
            </button>
            <button
              onClick={reload}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-black/10 rounded-full text-xs text-zinc-700 hover:bg-zinc-50"
              title="重玩一局 (F5)"
            >
              <RefreshCw size={13} />
              重玩
            </button>
            <button
              onClick={fullscreen}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-black/10 rounded-full text-xs text-zinc-700 hover:bg-zinc-50"
              title="全屏"
            >
              <Maximize2 size={13} />
              全屏
            </button>
          </div>
        </div>

        {/* 玩法面板 (默认收起, 可点击展开) */}
        {tipOpen && (
          <div className="mb-4 p-4 bg-white border border-black/10 rounded-2xl shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen size={15} className="text-violet-500" />
              <span className="text-sm font-semibold text-zinc-800">玩法速览</span>
              <span className="text-[10px] text-zinc-400 ml-1">v1.2.2 · 学玩结合</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {TIPS.map((t, i) => (
                <div key={i} className="flex gap-3 p-3 bg-zinc-50 rounded-xl">
                  <div className="text-2xl flex-shrink-0">{t.icon}</div>
                  <div className="flex-1">
                    <div className="text-xs font-semibold text-zinc-700">{t.title}</div>
                    <div className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">{t.text}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800 leading-relaxed">
              <strong>本项目是娱乐向网页小游戏，与任何真实人物、品牌或机构不存在官方关联，也不提供升学、就业或专业选择建议。</strong>
              知识点覆盖：高一语文/数学/英语/物理/化学/生物/政治/历史/地理 必修一。游戏里只展示了题目，答案在卡片右下角以浅色字呈现。
            </div>
          </div>
        )}

        {/* Game iframe */}
        <div className="rounded-2xl overflow-hidden border border-black/10 shadow-lg bg-zinc-900 relative">
          <iframe
            ref={iframeRef}
            key={iframeKey}
            src={GAME_URL}
            title="张雪峰快跑 — 高一背诵版"
            className="w-full block"
            style={{ height: 'min(78vh, 720px)', border: 'none' }}
            allow="autoplay"
          />
        </div>

        {/* Footer info */}
        <div className="mt-4 flex items-center justify-between text-[11px] text-zinc-400">
          <div className="flex items-center gap-1.5">
            <ChevronRight size={11} />
            <span>原作: github.com/yzz129/zxf_running</span>
          </div>
          <div>学业参谋部 v1.2.2 · 课间解压仅做加法，不删原游戏任何元素</div>
        </div>
      </div>
    </div>
  )
}