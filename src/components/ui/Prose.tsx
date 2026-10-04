export function Prose({ text, className }: { text: string; className?: string }) {
  const paragraphs = text.split('\n\n')
  return (
    <div className={className}>
      {paragraphs.map((p, i) => (
        <p key={i} className={i > 0 ? 'mt-4' : undefined}>
          {p}
        </p>
      ))}
    </div>
  )
}
