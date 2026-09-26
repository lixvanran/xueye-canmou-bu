/**
 * TodayPage - v2.0 新增
 *
 * "今日" 主页: 整合今日日程 / 待办 / 学习提示 / 智能体入口。
 * 本期只放骨架: 标题 + 描述 + 由其他任务填充。
 */
import { Sparkles, Calendar, BookOpen, MessageCircle, TrendingUp } from 'lucide-react'

export default function TodayPage() {
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
              <h1 className="text-2xl font-bold text-zinc-800">今日</h1>
              <p className="text-sm text-zinc-500 mt-0.5">
                一眼看完今天的安排、学习进度、智能体动态
              </p>
            </div>
          </div>
        </div>

        {/* 占位网格 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PlaceholderCard
            icon={<Calendar size={18} className="text-blue-500" />}
            title="今日日程"
            desc="今天的待办、学习计划、生日提醒"
          />
          <PlaceholderCard
            icon={<BookOpen size={18} className="text-emerald-500" />}
            title="学习进度"
            desc="错题整理、知识点掌握度、推荐练习"
          />
          <PlaceholderCard
            icon={<MessageCircle size={18} className="text-violet-500" />}
            title="最近对话"
            desc="继续昨天没聊完的话题"
          />
          <PlaceholderCard
            icon={<TrendingUp size={18} className="text-rose-500" />}
            title="本周趋势"
            desc="学习时长、提分曲线、薄弱点提醒"
          />
        </div>

        {/* 提示 */}
        <div className="mt-8 text-center text-xs text-zinc-400">
          由其他任务填充 (日程 / 一键整理 / 知识图谱)
        </div>
      </div>
    </div>
  )
}

function PlaceholderCard({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode
  title: string
  desc: string
}) {
  return (
    <div className="bg-white/70 backdrop-blur border border-black/5 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h2 className="font-semibold text-zinc-800">{title}</h2>
      </div>
      <p className="text-sm text-zinc-500">{desc}</p>
      <div className="mt-3 text-xs text-zinc-400">建设中</div>
    </div>
  )
}