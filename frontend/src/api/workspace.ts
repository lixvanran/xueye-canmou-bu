/** Workspace API - v0.9.1 新增 */
import api from './client'

export async function uploadToWorkspace(file: File, onProgress?: (pct: number) => void): Promise<{
  success: boolean
  filename?: string
  original_name?: string
  path?: string
  size?: number
  message?: string
  error?: string
}> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const formData = new FormData()
    formData.append('file', file)
    formData.append('user_id', '1')

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100))
      }
    })
    xhr.addEventListener('load', () => {
      try {
        const data = JSON.parse(xhr.responseText)
        resolve(data)
      } catch (e) {
        reject(e)
      }
    })
    xhr.addEventListener('error', () => reject(new Error('网络错误')))
    xhr.addEventListener('abort', () => reject(new Error('上传取消')))

    xhr.open('POST', '/api/workspace/upload')
    xhr.send(formData)
  })
}

export async function listUploads(): Promise<{
  success: boolean
  items: Array<{ name: string; path: string; size: number; mtime: number }>
  total: number
}> {
  return api.get('/workspace/uploads')
}

/** v2.0: 流式讲题 (4 步 + 标准答案, 一次返回) — 错题卡片"题目讲解"按钮 */
export async function* streamExplainMistake(
  mistakeId: number,
  signal?: AbortSignal,
): AsyncGenerator<{ tag: string; content?: string; error?: string }, void, unknown> {
  const response = await fetch(`/api/workspace/mistakes/${mistakeId}/explain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
  })
  if (!response.body) throw new Error('No response body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    if (signal?.aborted) return
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
          yield parsed
        } catch {
          // 不是 JSON, 忽略
        }
      }
    }
  }
}

/** v2.0: 错题薄弱点分析 — ChatPage "分析薄弱点" 按钮调用 */
export async function getWeakTopics(user_id = 1, top_k = 5): Promise<{
  user_id: number
  total_mistakes: number
  unmastered_count: number
  top_k: number
  weak_topics: import('@/types').WeakTopic[]
  all_topics?: import('@/types').WeakTopic[]
}> {
  const { default: api } = await import('./client')
  const r = await api.post(
    '/workspace/mistakes/weak-topics',
    null,
    { params: { user_id, top_k } }
  )
  return r.data
}
