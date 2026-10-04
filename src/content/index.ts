import { en } from './en'
import { ar } from './ar'
import type { Lang, SiteContent } from './types'

export const contentByLang: Record<Lang, SiteContent> = { en, ar }
export type { Lang, SiteContent } from './types'
export * from './types'
