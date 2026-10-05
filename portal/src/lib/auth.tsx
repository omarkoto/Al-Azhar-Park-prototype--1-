import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from './api'

export interface Profile {
  id: string
  email: string
  fullName: string
  roles: string[]
  permissions: string[]
}

type Status = 'loading' | 'anonymous' | 'authenticated'

interface AuthValue {
  status: Status
  profile: Profile | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  /** UI only: hides what you cannot use. The server decides; every request is checked there too. */
  can: (permission: string) => boolean
}

const AuthContext = createContext<AuthValue | null>(null)
/** renew the access token this long before it expires */
const RENEW_MARGIN_SECONDS = 60

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [profile, setProfile] = useState<Profile | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const clear = useCallback(() => {
    window.clearTimeout(timer.current)
    api.setAccessToken(null)
    setProfile(null)
    setStatus('anonymous')
  }, [])

  useEffect(() => {
    api.onSessionLost = clear
    api.onTokenRenewed = (seconds) => {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => void api.refresh(), Math.max(10, seconds - RENEW_MARGIN_SECONDS) * 1000)
    }
    return () => {
      window.clearTimeout(timer.current)
    }
  }, [clear])

  // Restore the session on page load from the httpOnly refresh cookie (the access token is never stored).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (await api.refresh()) {
        try {
          const me = await api.get<Profile>('/auth/me')
          if (!cancelled) {
            setProfile(me)
            setStatus('authenticated')
          }
          return
        } catch {
          /* fall through to anonymous */
        }
      }
      if (!cancelled) setStatus('anonymous')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ accessToken: string; expiresIn: number; user: Profile }>('/auth/login', { email, password })
    api.setAccessToken(res.accessToken)
    api.onTokenRenewed(res.expiresIn)
    setProfile(res.user)
    setStatus('authenticated')
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', {})
    } finally {
      clear()
    }
  }, [clear])

  const value = useMemo<AuthValue>(
    () => ({ status, profile, login, logout, can: (p) => profile?.permissions.includes(p) ?? false }),
    [status, profile, login, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
