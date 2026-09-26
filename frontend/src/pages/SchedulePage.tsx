/**
 * SchedulePage - v2.0 新增
 *
 * "日程" 页面: 月历 / 列表 / 新建 / 删除 / 与 Agent 联动。
 * 本期只放骨架: 标题 + 描述 + 由其他任务填充。
 */
import { Calendar, Plus, List, CalendarDays } from 'lucide-react'

export default function SchedulePage() {
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center text-white shadow-md">
              <Calendar size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-zinc-800">日程</h1>
              <p className="text-sm text-zinc-500 mt-0.5">
                学习计划 / 作业 / 重要事项 — 由 Agent 帮你安排
              </p>
            </div>
          </div>
          <button
            disabled
            className="opacity-50 cursor-not-allowed inline-flex items-center gap-1.5 px-4 py-2 bg-zinc-900 text-white text-sm rounded-full"
            title="由其他任务填充"
          >
            <Plus size={14} />
            新建
          </button>
        </div>

        {/* View toggle placeholder */}
        <div className="flex gap-2 mb-4">
          <button
            disabled
            className="opacity-50 cursor-not-allowed inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white border border-black/5 rounded-full"
          >
            <CalendarDays size={12} />
            月历
          </button>
          <button
            disabled
            className="opacity-50 cursor-not-allowed inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white border border-black/5 rounded-full"
          >
            <List size={12} />
            列表
          </button>
        </div>

        {/* 占位区 */}
        <div className="bg-white/70 backdrop-blur border border-black/5 rounded-2xl p-8 shadow-sm">
          <div className="text-center text-zinc-500">
            <Calendar size={36} className="mx-auto mb-3 text-zinc-300" />
            <div className="font-medium text-zinc-700 mb-1">日程视图</div>
            <div className="text-sm text-zinc-400">
              由 schedule-search-export 任务填充:
              月历 + 列表 + 新建 modal + Agent 联动
            </div>
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-zinc-400">
          由其他任务填充
        </div>
      </div>
    </div>
  )
}