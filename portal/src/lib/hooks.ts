import { useCallback, useEffect, useState } from 'react'
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

  const reload = useCallback(async () => {
    if (path === null) return
    setLoading(true)
    try {
      setData(await api.get<T>(path))
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [path])

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, loading, error, reload, setData }
}
