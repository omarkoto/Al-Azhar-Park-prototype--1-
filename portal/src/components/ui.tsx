import { createContext, useCallback, useContext, useEffect, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

// ───────────────────────────── buttons ─────────────────────────────

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-teal-800 text-white shadow-sm hover:bg-teal-900 disabled:bg-teal-800/40',
  secondary: 'border border-sand-200 bg-white text-teal-900 hover:bg-sand-100 disabled:text-stone-400',
  danger: 'bg-red-700 text-white hover:bg-red-800 disabled:bg-red-700/40',
  ghost: 'text-teal-800 hover:bg-teal-50 disabled:text-stone-300',
}

export function Button({ variant = 'primary', busy, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={cx('inline-flex items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed', VARIANTS[variant], className)}
    >
      {busy && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />}
      {children}
    </button>
  )
}

// ───────────────────────────── form fields ─────────────────────────────

const INPUT = 'w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm text-stone-900 outline-none transition-colors focus:border-teal-700 focus:ring-2 focus:ring-teal-700/15 disabled:bg-sand-100 disabled:text-stone-500'

export function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold tracking-wide text-teal-900/70 uppercase">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-stone-500">{hint}</p>}
      {error && (
        <p role="alert" className="mt-1 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}

export function TextInput({ label, error, hint, className, rtl, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string; rtl?: boolean }) {
  const id = useId()
  return (
    <Field label={label} error={error} hint={hint} htmlFor={id}>
      <input id={id} {...rest} dir={rtl ? 'rtl' : undefined} aria-invalid={!!error} className={cx(INPUT, error ? 'border-red-500' : 'border-sand-200', rtl && 'text-right', className)} />
    </Field>
  )
}

export function TextArea({ label, error, hint, rtl, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string; hint?: string; rtl?: boolean }) {
  const id = useId()
  return (
    <Field label={label} error={error} hint={hint} htmlFor={id}>
      <textarea id={id} rows={3} {...rest} dir={rtl ? 'rtl' : undefined} aria-invalid={!!error} className={cx(INPUT, error ? 'border-red-500' : 'border-sand-200', rtl && 'text-right')} />
    </Field>
  )
}

export function Select({ label, error, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string }) {
  const id = useId()
  return (
    <Field label={label} error={error} htmlFor={id}>
      <select id={id} {...rest} className={cx(INPUT, error ? 'border-red-500' : 'border-sand-200')}>
        {children}
      </select>
    </Field>
  )
}

export function Checkbox({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={cx('inline-flex items-center gap-2 text-sm text-stone-800', disabled && 'opacity-60')}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 rounded border-stone-300 accent-teal-700" />
      {label}
    </label>
  )
}

// ───────────────────────────── layout pieces ─────────────────────────────

export function Card({ title, description, children, actions }: { title?: string; description?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-sand-200 bg-white p-5 shadow-[0_1px_2px_rgb(33_29_23/0.04)] md:p-6">
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="font-display text-lg font-semibold text-teal-900">{title}</h2>}
            {description && <p className="mt-1 text-sm text-stone-500">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  )
}

export function PageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-8 border-b border-sand-200 pb-5">
      <span className="mb-3 block h-0.5 w-10 rounded bg-gold-500" aria-hidden="true" />
      <h1 className="font-display text-3xl font-semibold text-teal-900">{title}</h1>
      {description && <p className="mt-1 max-w-2xl text-sm text-stone-500">{description}</p>}
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'success'; children: ReactNode }) {
  const tones = {
    info: 'border-sky-200 bg-sky-50 text-sky-900',
    warn: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-red-200 bg-red-50 text-red-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  }
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('rounded-lg border px-4 py-3 text-sm', tones[tone])}>
      {children}
    </div>
  )
}

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-3 py-10 text-sm text-stone-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-stone-400 border-t-transparent" aria-hidden="true" />
      {label}
    </div>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'teal' | 'amber' | 'red' }) {
  const tones = { neutral: 'bg-sand-100 text-stone-700', teal: 'bg-teal-100 text-teal-800', amber: 'bg-gold-100 text-gold-700', red: 'bg-red-50 text-red-800' }
  return <span className={cx('inline-block rounded-full px-2 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-teal-950/60 p-4 backdrop-blur-sm md:p-10" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-sand-200 px-5 py-4">
          <h2 className="font-display text-lg font-semibold text-teal-900">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-stone-500 hover:bg-stone-100">
            ✕
          </button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

// ───────────────────────────── toasts ─────────────────────────────

interface Toast {
  id: number
  tone: 'success' | 'error'
  text: string
}
const ToastContext = createContext<(tone: Toast['tone'], text: string) => void>(() => undefined)
export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((tone: Toast['tone'], text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, tone, text }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 3500)
  }, [])
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cx('pointer-events-auto rounded-xl px-4 py-3 text-sm shadow-lg', t.tone === 'success' ? 'bg-teal-800 text-white' : 'bg-red-700 text-white')}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
