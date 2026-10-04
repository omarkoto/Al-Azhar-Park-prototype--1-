import type { ReactNode } from 'react'
import { Eyebrow } from './ui/SectionHeading'
import { Container } from './ui/Container'
import { Reveal } from './ui/Reveal'

export function PageHero({
  eyebrow,
  title,
  lead,
  image,
  imageAlt,
  imagePosition,
  credit,
  children,
}: {
  eyebrow: string
  title: string
  lead?: string
  image: string
  imageAlt: string
  /** CSS object-position for the image, e.g. '50% 40%' */
  imagePosition?: string
  /** Photographer attribution, shown small in the corner (required by CC licences). */
  credit?: { text: string; href: string }
  children?: ReactNode
}) {
  return (
    <section className="relative flex min-h-[46vh] items-end overflow-hidden bg-teal-950 text-sand-50 md:min-h-[54vh]">
      <img src={image} alt={imageAlt} className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: imagePosition }} loading="eager" />
      <div className="absolute inset-0 bg-gradient-to-t from-teal-950/85 via-teal-950/25 to-transparent" />
      {credit ? (
        <a href={credit.href} target="_blank" rel="noopener noreferrer" className="absolute bottom-2 end-3 z-10 hidden text-[10px] text-sand-50/60 hover:text-sand-50 md:block">
          {credit.text}
        </a>
      ) : null}
      <Container className="relative py-14 md:py-20">
        <Reveal>
          <Eyebrow tone="sand">{eyebrow}</Eyebrow>
          <h1 className="font-display mt-5 max-w-2xl text-4xl leading-[1.1] font-medium md:text-5xl">{title}</h1>
          {lead ? <p className="mt-6 max-w-xl text-base leading-relaxed text-sand-100/85 md:text-lg">{lead}</p> : null}
          {children}
        </Reveal>
      </Container>
    </section>
  )
}
