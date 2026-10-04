import clsx from 'clsx'

let uid = 0

export function LatticePattern({ className, id }: { className?: string; id?: string }) {
  const patternId = id ?? `lattice-${++uid}`
  return (
    <svg className={clsx('pointer-events-none absolute inset-0 h-full w-full', className)} aria-hidden="true">
      <defs>
        <pattern id={patternId} width="64" height="64" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <path d="M32 0 L64 32 L32 64 L0 32 Z" fill="none" stroke="currentColor" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  )
}
