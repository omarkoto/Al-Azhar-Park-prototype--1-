import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export interface CartLine {
  ticketId: string
  label: string
  unitPrice: number
  qty: number
  visitDate: string | null
}

interface CartContextValue {
  lines: CartLine[]
  addLine: (line: Omit<CartLine, 'qty'>, qty?: number) => void
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
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(readStored)
  const [isOpen, setIsOpen] = useState(false)
  const [lastAdded, setLastAdded] = useState(0)

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines))
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
