/** 聊天 API - 流式 SSE + 工具事件解析 */
import type { Scenario } from '@/types'

export interface ChatParams {
  message: string
  scenario: Scenario
  conversation_id?: number
  user_id?: number
  stream?: boolean
  web_search_enabled?: boolean
  deep_thinking_enabled?: boolean
}

export type StreamEventType =
  | 'content' | 'rag' | 'rag_trace' | 'route' | 'tools' | 'search_results' | 'reasoning' | 'thinking' | 'stopped'
  // v0.1.7: 运行过程可视化 — 完整时间线事件
  | 'start' | 'ctx' | 'llm_done' | 'end'

export interface StreamEvent {
  type: StreamEventType
  data: any
}

// 过滤 LLM 输出中的 raw tool call / 占位文本
function sanitizeContent(text: string): string {
  if (!text) return text
  return text
    .replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/g, '')
    .replace(/<\/?\s*tool_call\s*>/g, '')
    .replace(/<\/?invoke>/g, '')
    .replace(/\]\s*<\s*minimax\s*>\s*\[\s*<query>[\s\S]*?<\/query>\s*\]/g, '')
    .replace(/<\s*minimax\s*>/g, '')
    .replace(/<\s*\/\s*minimax\s*>/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

/** 流式聊天 - AsyncGenerator, 用 yield 推 event */
export async function* streamChat(
  params: ChatParams,
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent, void, unknown> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params, stream: true, user_id: params.user_id || 1 }),
    signal,
  })
  if (!response.body) throw new Error('No response body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    // v0.8.0: 客户端 abort 时立即退出循环, 不要等网络
    if (signal?.aborted) {
      console.log('[streamChat] aborted by user')
      return
    }
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value)
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6)
        if (data === '[DONE]') return
        try {
          const parsed = JSON.parse(data)
          if (!parsed.content) continue
          // 解析 [TAG]...[/TAG] 事件
          if (parsed.content.includes('[RAG]') && parsed.content.includes('[/RAG]')) {
            const m = parsed.content.match(/\[RAG\](.*?)\[\/RAG\]/)
            if (m) { yield { type: 'rag', data: JSON.parse(m[1]) }; continue }
          }
          // v0.1: RAG 全过程 trace
          if (parsed.content.includes('[RAG_TRACE]') && parsed.content.includes('[/RAG_TRACE]')) {
            const m = parsed.content.match(/\[RAG_TRACE\](.*?)\[\/RAG_TRACE\]/)
            if (m) {
              try {
                yield { type: 'rag_trace', data: JSON.parse(m[1]) }
              } catch (e) {
                console.error('RAG_TRACE parse failed', e)
              }
              continue
            }
          }
          if (parsed.content.includes('[ROUTE]') && parsed.content.includes('[/ROUTE]')) {
            const m = parsed.content.match(/\[ROUTE\](.*?)\[\/ROUTE\]/)
            if (m) { yield { type: 'route', data: JSON.parse(m[1]) }; continue }
          }
          if (parsed.content.includes('[TOOL_CALLS]')) {
            const m = parsed.content.match(/\[TOOL_CALLS\](.*?)\[\/TOOL_CALLS\]/)
            if (m) { yield { type: 'tools', data: JSON.parse(m[1]) }; continue }
          }
          if (parsed.content.includes('[TOOL_RESULTS]')) {
            const m = parsed.content.match(/\[TOOL_RESULTS\](.*?)\[\/TOOL_RESULTS\]/)
            if (m) { yield { type: 'search_results', data: JSON.parse(m[1]) }; continue }
          }
          if (parsed.content.includes('[THINKING]') && parsed.content.includes('[/THINKING]')) {
            const m = parsed.content.match(/\[THINKING\](.*?)\[\/THINKING\]/)
            if (m) { yield { type: 'thinking', data: m[1] }; continue }
          }
          if (parsed.content.includes('[REASONING]') && parsed.content.includes('[/REASONING]')) {
            const m = parsed.content.match(/\[REASONING\](.*?)\[\/REASONING\]/)
            if (m) { yield { type: 'reasoning', data: JSON.parse(m[1]) }; continue }
          }
          if (parsed.content.includes('[STOPPED]')) {
            yield { type: 'stopped', data: parsed.content }
            continue
          }
          // v0.1.7: 运行过程可视化事件 (START / CTX / LLM_DONE / END)
          if (parsed.content.includes('[START]') && parsed.content.includes('[/START]')) {
            const m = parsed.content.match(/\[START\](.*?)\[\/START\]/)
            if (m) { yield { type: 'start', data: JSON.parse(m[1]) }; continue }
          }
          if (parsed.content.includes('[CTX]') && parsed.content.includes('[/CTX]')) {
            const m = parsed.content.match(/\[CTX\](.*?)\[\/CTX\]/)
            if (m) { yield { type: 'ctx', data: JSON.parse(m[1]) }; continue }
          }
          if (parsed.content.includes('[LLM_DONE]') && parsed.content.includes('[/LLM_DONE]')) {
            const m = parsed.content.match(/\[LLM_DONE\](.*?)\[\/LLM_DONE\]/)
            if (m) { yield { type: 'llm_done', data: JSON.parse(m[1]) }; continue }
          }
          if (parsed.content.includes('[END]') && parsed.content.includes('[/END]')) {
            const m = parsed.content.match(/\[END\](.*?)\[\/END\]/)
            if (m) { yield { type: 'end', data: JSON.parse(m[1]) }; continue }
          }
          yield { type: 'content', data: sanitizeContent(parsed.content) }
        } catch {}
      }
    }
  }
}
