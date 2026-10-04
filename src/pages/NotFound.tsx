import { useLanguage } from '../lib/language'
import { Container } from '../components/ui/Container'
import { ButtonLink } from '../components/ui/Button'

export function NotFound() {
  const { lang } = useLanguage()
  return (
    <Container className="flex min-h-[60vh] flex-col items-center justify-center py-24 text-center">
      <p className="font-display text-6xl text-teal-700">404</p>
      <h1 className="font-display mt-4 text-2xl font-medium text-ink-900">
        {lang === 'en' ? 'Page not found' : 'الصفحة غير موجودة'}
      </h1>
      <ButtonLink to="/" className="mt-8">
        {lang === 'en' ? 'Back to home' : 'العودة إلى الرئيسية'}
      </ButtonLink>
    </Container>
  )
}
