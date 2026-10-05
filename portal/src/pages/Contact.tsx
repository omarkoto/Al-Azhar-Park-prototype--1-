import { useEffect, useState, type FormEvent } from 'react'
import { Button, Card, Notice, PageHeader, Spinner, TextArea, TextInput, useToast } from '../components/ui'
import { api, errorMessage, fieldErrors } from '../lib/api'
import { useAuth } from '../lib/auth'
import { contactToForm, formToContact, SOCIAL_KEYS, type ContactData, type ContactForm } from '../lib/forms'
import { useLoad } from '../lib/hooks'

const SOCIAL_LABELS: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', x: 'X (Twitter)', youtube: 'YouTube', tiktok: 'TikTok', linkedin: 'LinkedIn' }

export function ContactPage() {
  const { can } = useAuth()
  const toast = useToast()
  const { data, loading, error, setData } = useLoad<ContactData & { updatedAt: string }>('/contact')
  const [form, setForm] = useState<ContactForm | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const canWrite = can('contact:write')

  useEffect(() => {
    if (data) setForm(contactToForm(data))
  }, [data])

  if (loading && !form) return <Spinner />
  if (error && !form) return <Notice tone="error">{error}</Notice>
  if (!form) return null

  const set = <K extends keyof ContactForm>(key: K, value: ContactForm[K]) => setForm({ ...form, [key]: value })

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!form) return
    setBusy(true)
    setErrors({})
    try {
      const saved = await api.put<ContactData & { updatedAt: string }>('/contact', formToContact(form))
      setData(saved)
      toast('success', 'Contact details saved.')
    } catch (err) {
      const fe = fieldErrors(err)
      // the server reports a phone problem on "phones" or "phones.N"; show it under the phones box
      const phoneIssue = Object.entries(fe).find(([k]) => k.startsWith('phones'))?.[1]
      setErrors({ ...fe, ...(phoneIssue ? { phones: phoneIssue } : {}) })
      toast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <PageHeader title="Contact details" description="Shown on the Contact page, the footer and the map buttons of the public website." />
      {!canWrite && <Notice tone="info">You can view this page but not change it.</Notice>}

      <Card title="Address">
        <fieldset disabled={!canWrite || busy} className="grid gap-4 md:grid-cols-2">
          <TextArea label="Address (English)" value={form.addressEn} onChange={(e) => set('addressEn', e.target.value)} error={errors.addressEn} maxLength={300} />
          <TextArea label="Address (Arabic)" rtl value={form.addressAr} onChange={(e) => set('addressAr', e.target.value)} error={errors.addressAr} maxLength={300} />
        </fieldset>
      </Card>

      <Card title="Phone and e-mail">
        <fieldset disabled={!canWrite || busy} className="grid gap-4 md:grid-cols-2">
          <TextArea label="Phone numbers" hint="One per line, up to 6." value={form.phones} onChange={(e) => set('phones', e.target.value)} error={errors.phones} />
          <div className="space-y-4">
            <TextInput label="Fax" value={form.fax} onChange={(e) => set('fax', e.target.value)} error={errors.fax} />
            <TextInput label="E-mail" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} error={errors.email} />
          </div>
        </fieldset>
      </Card>

      <Card title="Map" description="Coordinates give the most exact pin and directions. The link must be a Google Maps address (https).">
        <fieldset disabled={!canWrite || busy} className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <TextInput label="Google Maps link" type="url" value={form.mapsUrl} onChange={(e) => set('mapsUrl', e.target.value)} error={errors.mapsUrl} placeholder="https://www.google.com/maps?cid=…" />
          </div>
          <TextInput label="Latitude" inputMode="decimal" value={form.latitude} onChange={(e) => set('latitude', e.target.value)} error={errors.latitude} placeholder="30.0405" />
          <TextInput label="Longitude" inputMode="decimal" value={form.longitude} onChange={(e) => set('longitude', e.target.value)} error={errors.longitude} placeholder="31.2655" />
        </fieldset>
      </Card>

      <Card title="Social media" description="Leave a field empty to hide that icon on the website.">
        <fieldset disabled={!canWrite || busy} className="grid gap-4 md:grid-cols-2">
          {SOCIAL_KEYS.map((k) => (
            <TextInput
              key={k}
              label={SOCIAL_LABELS[k]}
              type="url"
              value={form.social[k] ?? ''}
              onChange={(e) => set('social', { ...form.social, [k]: e.target.value })}
              error={errors[`socialLinks.${k}`]}
              placeholder="https://"
            />
          ))}
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
