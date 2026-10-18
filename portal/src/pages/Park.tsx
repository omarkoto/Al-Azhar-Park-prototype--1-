import { useEffect, useState, type FormEvent } from 'react'
import { Button, Card, Notice, PageHeader, Spinner, TextArea, TextInput, useToast } from '../components/ui'
import { api, errorMessage, fieldErrors } from '../lib/api'
import { useAuth } from '../lib/auth'
import { formToPark, type ParkData } from '../lib/forms'
import { useLoad } from '../lib/hooks'

type Form = { [K in keyof ParkData]: ParkData[K] extends string | null ? string : ParkData[K] }

const toForm = (p: ParkData): Form => ({
  nameEn: p.nameEn, nameAr: p.nameAr, taglineEn: p.taglineEn ?? '', taglineAr: p.taglineAr ?? '', descriptionEn: p.descriptionEn ?? '', descriptionAr: p.descriptionAr ?? '', stats: p.stats,
})

export function ParkPage() {
  const { can } = useAuth()
  const toast = useToast()
  const { data, loading, error, setData } = useLoad<ParkData & { updatedAt: string }>('/park')
  const [form, setForm] = useState<Form | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const canWrite = can('park:write')

  useEffect(() => {
    if (data) setForm(toForm(data))
  }, [data])

  if (loading && !form) return <Spinner />
  if (error && !form) return <Notice tone="error">{error}</Notice>
  if (!form) return null

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm({ ...form, [key]: value })
  const setStat = (i: number, patch: Partial<Form['stats'][number]>) => set('stats', form.stats.map((s, j) => (j === i ? { ...s, ...patch } : s)))

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    setBusy(true)
    setErrors({})
    try {
      const saved = await api.put<ParkData & { updatedAt: string }>('/park', formToPark(form))
      setData(saved)
      toast('success', 'Park information saved.')
    } catch (err) {
      setErrors(fieldErrors(err))
      toast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <PageHeader title="Park information" description="The name, tagline, description and the headline statistics. Every text has an English and an Arabic version." />
      {!canWrite && <Notice tone="info">You can view this page but not change it.</Notice>}

      <Card title="Name, tagline and description">
        <fieldset disabled={!canWrite || busy} className="grid gap-4 md:grid-cols-2">
          <TextInput label="Name (English)" value={form.nameEn} onChange={(e) => set('nameEn', e.target.value)} error={errors.nameEn} maxLength={100} />
          <TextInput label="Name (Arabic)" rtl value={form.nameAr} onChange={(e) => set('nameAr', e.target.value)} error={errors.nameAr} maxLength={100} />
          <TextInput label="Tagline (English)" value={form.taglineEn} onChange={(e) => set('taglineEn', e.target.value)} error={errors.taglineEn} maxLength={200} />
          <TextInput label="Tagline (Arabic)" rtl value={form.taglineAr} onChange={(e) => set('taglineAr', e.target.value)} error={errors.taglineAr} maxLength={200} />
          <TextArea label="Description (English)" value={form.descriptionEn} onChange={(e) => set('descriptionEn', e.target.value)} error={errors.descriptionEn} maxLength={2000} />
          <TextArea label="Description (Arabic)" rtl value={form.descriptionAr} onChange={(e) => set('descriptionAr', e.target.value)} error={errors.descriptionAr} maxLength={2000} />
        </fieldset>
      </Card>

      <Card title="Statistics" description="Shown on the home and About pages. Up to 8. Write numbers the way they should appear (for example 72, or ٧٢ in Arabic).">
        <fieldset disabled={!canWrite || busy} className="space-y-4">
          {form.stats.length === 0 && <p className="text-sm text-stone-500">No statistics. The website will use its built-in ones.</p>}
          {form.stats.map((s, i) => (
            <div key={i} className="grid gap-3 rounded-lg border border-sand-200 p-3 md:grid-cols-[7rem_1fr_1fr_auto] md:items-end">
              <TextInput label="Value" value={s.value} onChange={(e) => setStat(i, { value: e.target.value })} error={errors[`stats.${i}.value`]} maxLength={20} />
              <TextInput label="Label (English)" value={s.labelEn} onChange={(e) => setStat(i, { labelEn: e.target.value })} error={errors[`stats.${i}.labelEn`]} />
              <TextInput label="Label (Arabic)" rtl value={s.labelAr} onChange={(e) => setStat(i, { labelAr: e.target.value })} error={errors[`stats.${i}.labelAr`]} />
              <Button type="button" variant="ghost" onClick={() => set('stats', form.stats.filter((_, j) => j !== i))} aria-label={`Remove statistic ${i + 1}`}>
                Remove
              </Button>
            </div>
          ))}
          {form.stats.length < 8 && (
            <Button type="button" variant="secondary" onClick={() => set('stats', [...form.stats, { value: '', labelEn: '', labelAr: '' }])}>
              Add a statistic
            </Button>
          )}
          {errors.stats && <p className="text-xs font-medium text-red-700">{errors.stats}</p>}
        </fieldset>
      </Card>

      {canWrite && (
        <div className="flex items-center gap-4">
          <Button type="submit" busy={busy}>
            Save changes
          </Button>
          {data && <span className="text-xs text-stone-500">Last saved {new Date(data.updatedAt).toLocaleString()}</span>}
        </div>
      )}
    </form>
  )
}
