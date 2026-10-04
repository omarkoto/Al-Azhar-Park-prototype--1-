import clsx from 'clsx'

export function ArchFrame({
  src,
  alt,
  className,
}: {
  src: string
  alt: string
  className?: string
}) {
  return (
    <div className={clsx('relative overflow-hidden bg-teal-800', className)} style={{ clipPath: 'url(#arch-clip)' }}>
      <img src={src} alt={alt} className="h-full w-full object-cover" loading="lazy" />
    </div>
  )
}
