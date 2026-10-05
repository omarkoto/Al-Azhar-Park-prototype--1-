import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errorMessage } from './api'

export interface Loaded<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => Promise<void>
  setData: (value: T) => void
}

/** Loads a GET endpoint once (and again on reload()). */
export function useLoad<T>(path: string | null): Loaded<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(path !== null)
  const [error, setError] = useState<string | null>(null)
  // only the newest request may update the screen: an older, slower response must never overwrite newer data
  // (or the edits someone has already started typing — React StrictMode, for one, issues two loads in development)
  const latest = useRef(0)

  const reload = useCallback(async () => {
    if (path === null) return
    const mine = ++latest.current
    setLoading(true)
    try {
      const result = await api.get<T>(path)
      if (mine === latest.current) {
        setData(result)
        setError(null)
      }
    } catch (e) {
      if (mine === latest.current) setError(errorMessage(e))
    } finally {
      if (mine === latest.current) setLoading(false)
    }
  }, [path])

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, loading, error, reload, setData }
}
