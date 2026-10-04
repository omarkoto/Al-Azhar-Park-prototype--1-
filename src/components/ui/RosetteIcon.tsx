export function RosetteIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" strokeLinejoin="round" />
      <rect x="5" y="5" width="14" height="14" transform="rotate(45 12 12)" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}
