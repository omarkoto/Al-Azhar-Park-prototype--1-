import clsx from 'clsx'
import { useLanguage } from '../lib/language'
import logoAr from '../assets/brand/logo-ar.png'
import logoEn from '../assets/brand/logo-en.png'

export function BrandMark({
  tone = 'default',
  size = 'md',
}: {
  tone?: 'default' | 'inverted'
  size?: 'md' | 'sm'
}) {
  const { lang, content } = useLanguage()
  const src = lang === 'ar' ? logoAr : logoEn

  return (
    <img
      src={src}
      alt={content.meta.title}
      className={clsx('w-auto', size === 'sm' ? 'h-8' : 'h-10 md:h-11', tone === 'inverted' && 'brightness-0 invert')}
    />
  )
}
