import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Button, Notice, Spinner, TextInput } from '../components/ui'
import { errorMessage } from '../lib/api'
import { useAuth } from '../lib/auth'
import logoEn from '../assets/logo-en.png'
import hero from '../assets/login-hero.webp'

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
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-teal-950 lg:block">
        <img src={hero} alt="" className="absolute inset-0 h-full w-full object-cover opacity-60" />
        <div className="absolute inset-0 bg-gradient-to-t from-teal-950 via-teal-950/40 to-teal-900/30" />
        <div className="relative flex h-full flex-col justify-end p-14 text-sand-50">
          <span className="mb-5 block h-0.5 w-12 rounded bg-gold-500" aria-hidden="true" />
          <p className="font-display text-4xl leading-tight font-semibold">Caring for Cairo’s<br />green heart.</p>
          <p className="mt-4 max-w-md text-sm text-sand-100/75">Tickets, gates, events and park information — everything the team needs, in one place.</p>
        </div>
      </div>

      <div className="flex items-center justify-center bg-sand-50 px-6 py-12">
        <form onSubmit={submit} className="w-full max-w-sm space-y-5">
          <img src={logoEn} alt="Al-Azhar Park" className="mb-2 h-16 w-auto" />
          <div>
            <h1 className="text-3xl font-semibold text-teal-900">Welcome back</h1>
            <p className="mt-1 text-sm text-stone-500">Sign in to the staff portal.</p>
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          <TextInput label="Email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <TextInput label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button type="submit" busy={busy} className="w-full py-3">
            Sign in
          </Button>
          <p className="text-xs text-stone-400">Forgot your password? Ask an administrator to send you a reset link.</p>
        </form>
      </div>
    </div>
  )
}
