import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { parseTicketId, sanitizeLines } from './booking'

export interface CartLine {
  /** the audience and ticket type, e.g. "RESIDENT:ADULT" (the server decides the price; the unit price here is only a preview) */
  ticketId: string
  label: string
  unitPrice: number
  qty: number
  visitDate: string | null
}

/** One order is for one visit date and one audience: adding a different date or audience starts a fresh cart. */
export function mergeSelection(current: CartLine[], incoming: CartLine[]): CartLine[] {
  if (incoming.length === 0) return current
  const audienceOf = (l: CartLine) => parseTicketId(l.ticketId)?.audience
  const sameOrder = current.every((l) => l.visitDate === incoming[0].visitDate && audienceOf(l) === audienceOf(incoming[0]))
  if (current.length === 0 || !sameOrder) return incoming
  const merged = [...current]
  for (const line of incoming) {
    const at = merged.findIndex((l) => l.ticketId === line.ticketId && l.visitDate === line.visitDate)
    if (at >= 0) merged[at] = { ...merged[at], qty: merged[at].qty + line.qty, unitPrice: line.unitPrice }
    else merged.push(line)
  }
  return merged
}

interface CartContextValue {
  lines: CartLine[]
  addLine: (line: Omit<CartLine, 'qty'>, qty?: number) => void
  addSelection: (lines: CartLine[]) => void
  updateQty: (ticketId: string, visitDate: string | null, qty: number) => void
  removeLine: (ticketId: string, visitDate: string | null) => void
  clear: () => void
  totalCount: number
  totalPrice: number
  isOpen: boolean
  open: () => void
  close: () => void
  lastAdded: number
}

const CartContext = createContext<CartContextValue | null>(null)
const STORAGE_KEY = 'azharpark-cart'

function lineKey(ticketId: string, visitDate: string | null) {
  return `${ticketId}__${visitDate ?? 'any'}`
}

function readStored(): CartLine[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return sanitizeLines<CartLine>(JSON.parse(raw))
  } catch {
    return []
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(readStored)
  const [isOpen, setIsOpen] = useState(false)
  const [lastAdded, setLastAdded] = useState(0)

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines))
    } catch {
      /* private mode: the cart simply is not remembered */
    }
  }, [lines])

  function addLine(line: Omit<CartLine, 'qty'>, qty = 1) {
    setLines((current) => {
      const key = lineKey(line.ticketId, line.visitDate)
      const existing = current.find((l) => lineKey(l.ticketId, l.visitDate) === key)
      if (existing) {
        return current.map((l) => (lineKey(l.ticketId, l.visitDate) === key ? { ...l, qty: l.qty + qty } : l))
      }
      return [...current, { ...line, qty }]
    })
    setLastAdded(Date.now())
  }

  function addSelection(incoming: CartLine[]) {
    setLines((current) => mergeSelection(current, incoming))
    setLastAdded(Date.now())
  }

  function updateQty(ticketId: string, visitDate: string | null, qty: number) {
    setLines((current) => {
      const key = lineKey(ticketId, visitDate)
      if (qty <= 0) return current.filter((l) => lineKey(l.ticketId, l.visitDate) !== key)
      return current.map((l) => (lineKey(l.ticketId, l.visitDate) === key ? { ...l, qty } : l))
    })
  }

  function removeLine(ticketId: string, visitDate: string | null) {
    const key = lineKey(ticketId, visitDate)
    setLines((current) => current.filter((l) => lineKey(l.ticketId, l.visitDate) !== key))
  }

  function clear() {
    setLines([])
  }

  const totalCount = useMemo(() => lines.reduce((sum, l) => sum + l.qty, 0), [lines])
  const totalPrice = useMemo(() => lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0), [lines])

  const value: CartContextValue = {
    lines,
    addLine,
    addSelection,
    updateQty,
    removeLine,
    clear,
    totalCount,
    totalPrice,
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    lastAdded,
  }

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used within a CartProvider')
  return ctx
}
