/**
 * useAgentName - 全局 Agent 称呼 (v2.0)
 *
 * - 默认 "张雪峰"
 * - 启动时从 /api/user/profile 读取 profile.agent_name
 * - 暴露 [name, setName] 给 UI 绑定
 * - setName: 写到 localStorage 立刻生效 (UI 同步), 并异步 PUT /api/user/profile
 *   失败时回滚 localStorage
 * - SettingsModal 保存后调用 reload() 拉取最新值
 */
import { useEffect, useState, useCallback } from 'react'
import { getUserProfile, updateUserProfile } from '@/api'

const STORAGE_KEY = 'agent_name'
const DEFAULT_NAME = '张雪峰'

function readLocal(): string {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v && v.trim()) return v
  } catch {
    // localStorage 不可用 (SSR / 隐私模式) → 忽略
  }
  return DEFAULT_NAME
}

function writeLocal(name: string) {
  try {
    localStorage.setItem(STORAGE_KEY, name)
  } catch {
    // ignore
  }
}

export function useAgentName(): [string, (name: string) => Promise<void>, () => Promise<void>] {
  const [name, setNameState] = useState<string>(() => readLocal())

  // 初次 mount: 从 profile 拉取, 覆盖 localStorage 默认值
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const profile: any = await getUserProfile()
        const fromApi = profile?.agent_name
        if (!cancelled && typeof fromApi === 'string' && fromApi.trim()) {
          setNameState(fromApi)
          writeLocal(fromApi)
        }
      } catch {
        // 后端未实现 / 网络错误 → 保留 localStorage 默认值
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const reload = useCallback(async () => {
    try {
      const profile: any = await getUserProfile()
      const fromApi = profile?.agent_name
      if (typeof fromApi === 'string' && fromApi.trim()) {
        setNameState(fromApi)
        writeLocal(fromApi)
      }
    } catch {
      // ignore
    }
  }, [])

  const setName = useCallback(async (next: string) => {
    const trimmed = (next || '').trim() || DEFAULT_NAME
    const prev = name
    // 乐观更新: 立即反映到 UI
    setNameState(trimmed)
    writeLocal(trimmed)
    try {
      // 尝试同步到后端 profile; 后端字段可能尚未实现, 失败不致命
      await updateUserProfile({ agent_name: trimmed } as any)
    } catch (e: any) {
      // 检查是否是 4xx (字段不存在) — 这种不算严重错误
      const status = e?.response?.status
      if (status && status >= 400 && status < 500) {
        // 字段暂未启用 → 保留 localStorage 值即可
        console.warn('[useAgentName] profile.agent_name not persisted yet:', e?.message)
        return
      }
      // 其他错误回滚
      setNameState(prev)
      writeLocal(prev)
      throw e
    }
  }, [name])

  return [name, setName, reload]
}

// 单次拉取 (供 App.tsx 等需要 fire-and-forget 的场景)
export async function fetchAgentName(): Promise<string> {
  try {
    const profile: any = await getUserProfile()
    const v = profile?.agent_name
    if (typeof v === 'string' && v.trim()) {
      writeLocal(v)
      return v
    }
  } catch {
    // ignore
  }
  return readLocal()
}

// 静默触发后端拉取, 不返回值
export function refreshAgentNameFromProfile(): void {
  // 异步执行, 不阻塞调用方
  fetchAgentName().catch(() => {})
}

// 暴露给外部 (如单元测试) 的常量
export const AGENT_NAME_DEFAULT = DEFAULT_NAME
export const AGENT_NAME_STORAGE_KEY = STORAGE_KEY