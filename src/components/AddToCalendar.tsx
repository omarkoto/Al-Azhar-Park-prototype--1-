import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { downloadIcs, googleCalendarUrl, type CalendarEntry } from '../lib/calendar'
import { ExternalLink, Button } from './ui/Button'

export function AddToCalendar({ entry, filename, className }: { entry: CalendarEntry; filename: string; className?: string }) {
  const { t } = useTranslation()
  return (
    <div className={clsx('space-y-3', className)}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-900/45">{t('addToCalendar')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <ExternalLink
          href={googleCalendarUrl(entry)}
          target="_blank"
          rel="noopener noreferrer"
          variant="ghost"
          className="justify-center border-ink-900/20 text-ink-900"
        >
          <CalendarIcon />
          {t('googleCalendar')}
        </ExternalLink>
        <Button variant="ghost" className="justify-center border-ink-900/20 text-ink-900" onClick={() => downloadIcs(entry, filename)}>
          <CalendarIcon />
          {t('appleCalendar')}
        </Button>
      </div>
    </div>
  )
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="3.5" y="4.5" width="13" height="12" rx="1.5" />
      <path d="M3.5 8h13M7 3v3M13 3v3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
