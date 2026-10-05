import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Button, Notice, Spinner, TextInput } from '../components/ui'
import { errorMessage } from '../lib/api'
import { useAuth } from '../lib/auth'

export function Login() {
  const { status, login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (status === 'loading') return <Spinner label="Checking your session…" />
  if (status === 'authenticated') return <Navigate to="/" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email, password)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50 px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-5 rounded-xl border border-stone-200 bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold text-teal-900">Al-Azhar Park</h1>
          <p className="text-sm text-stone-500">Staff portal — sign in</p>
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        <TextInput label="Email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <TextInput label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" busy={busy} className="w-full">
          Sign in
        </Button>
        <p className="text-xs text-stone-400">Forgot your password? Ask an administrator to send you a reset link.</p>
      </form>
    </div>
  )
}
