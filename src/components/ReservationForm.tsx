import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui/Button'

function generateReference() {
  return `RES-${Date.now().toString(36).toUpperCase().slice(-6)}`
}

export function ReservationForm({ restaurantName }: { restaurantName: string }) {
  const { t } = useTranslation()
  const [submitted, setSubmitted] = useState<{ name: string; ref: string } | null>(null)
  const [name, setName] = useState('')

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitted({ name, ref: generateReference() })
  }

  if (submitted) {
    return (
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 text-2xl">✓</div>
        <p className="mt-4 text-base font-medium text-ink-900">{t('requestReceivedTitle')}</p>
        <p className="mt-2 text-sm leading-relaxed text-ink-900/65">
          {t('requestReceivedBody', { name: submitted.name, ref: submitted.ref })}
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-sm text-ink-900/60">{restaurantName}</p>
      <div className="grid grid-cols-2 gap-4">
        <TextField label={t('fullName')} type="text" required value={name} onChange={setName} full />
        <TextField label={t('email')} type="email" required />
        <TextField label={t('phone')} type="tel" />
        <TextField label={t('partySize')} type="number" defaultValue={2} min={1} />
        <TextField label={t('visitDate')} type="date" />
        <TextField label={t('preferredTime')} type="time" />
      </div>
      <p className="rounded-xl border border-gold-500/30 bg-gold-100/40 px-4 py-3 text-xs leading-relaxed text-ink-900/70">
        {t('requestNote')}
      </p>
      <Button type="submit" className="w-full justify-center">
        {t('submitRequest')}
      </Button>
    </form>
  )
}

function TextField({
  label,
  type,
  required,
  value,
  onChange,
  full,
  defaultValue,
  min,
}: {
  label: string
  type: string
  required?: boolean
  value?: string
  onChange?: (v: string) => void
  full?: boolean
  defaultValue?: string | number
  min?: number
}) {
  const id = useId()
  return (
    <div className={full ? 'col-span-2' : undefined}>
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-ink-900/50">
        {label}
      </label>
      <input
        id={id}
        type={type}
        required={required}
        value={value}
        defaultValue={value === undefined ? defaultValue : undefined}
        min={min}
        onChange={(e) => onChange?.(e.target.value)}
        className="mt-2 w-full rounded-xl border border-ink-900/15 bg-sand-50 px-4 py-2.5 text-sm text-ink-900 outline-none focus:border-teal-700"
      />
    </div>
  )
}
