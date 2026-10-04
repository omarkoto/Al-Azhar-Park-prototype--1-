export type TicketCategory = 'resident' | 'visitor'
export type TicketType = 'adult' | 'child'
export type TicketDay = 'weekday' | 'weekend'

export interface TicketOption {
  id: string
  category: TicketCategory
  type: TicketType
  day: TicketDay
  price: number
}

// Canonical numeric prices (EGP), independent of display-language strings in
// content/*.ts, so cart math never has to parse localized number formats.
export const ticketCatalog: TicketOption[] = [
  { id: 'resident-adult-weekday', category: 'resident', type: 'adult', day: 'weekday', price: 50 },
  { id: 'resident-adult-weekend', category: 'resident', type: 'adult', day: 'weekend', price: 60 },
  { id: 'resident-child-weekday', category: 'resident', type: 'child', day: 'weekday', price: 35 },
  { id: 'resident-child-weekend', category: 'resident', type: 'child', day: 'weekend', price: 40 },
  { id: 'visitor-adult-weekday', category: 'visitor', type: 'adult', day: 'weekday', price: 150 },
  { id: 'visitor-adult-weekend', category: 'visitor', type: 'adult', day: 'weekend', price: 200 },
  { id: 'visitor-child-weekday', category: 'visitor', type: 'child', day: 'weekday', price: 100 },
  { id: 'visitor-child-weekend', category: 'visitor', type: 'child', day: 'weekend', price: 150 },
]

export function findTicket(id: string): TicketOption | undefined {
  return ticketCatalog.find((t) => t.id === id)
}

export function isWeekend(date: Date): boolean {
  // Park's own pricing splits Fri–Sat as the weekend rate.
  const day = date.getDay()
  return day === 5 || day === 6
}
