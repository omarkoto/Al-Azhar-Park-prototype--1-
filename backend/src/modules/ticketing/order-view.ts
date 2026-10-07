import { Customer, Order, OrderItem, Payment, Prisma, Ticket } from '@prisma/client';
import { dateToIso } from './rules/calendar';
import { dayTypeOf } from './rules/price-selection';

export const ORDER_INCLUDE = {
  items: { orderBy: { createdAt: 'asc' } },
  payments: { orderBy: { createdAt: 'desc' } },
  tickets: { orderBy: { createdAt: 'asc' } },
  customer: true,
} satisfies Prisma.OrderInclude;

export type OrderRow = Order & { items: OrderItem[]; payments: Payment[]; tickets: Ticket[]; customer: Customer | null };

/** What the customer sees of their own order. Never internal ids, never a payment secret. */
export interface OrderView {
  orderNumber: string;
  status: Order['status'];
  visitDate: string;
  dayType: 'WEEKDAY' | 'WEEKEND';
  currency: string;
  totalMinor: number;
  /** when an unpaid order stops being held */
  expiresAt: Date | null;
  paidAt: Date | null;
  createdAt: Date;
  customer: { fullName: string; email: string | null } | null;
  items: Array<{ typeNameEn: string; typeNameAr: string; audienceNameEn: string; audienceNameAr: string; unitPriceMinor: number; quantity: number; lineTotalMinor: number }>;
  payment: { status: Payment['status']; provider: string; isMock: boolean; providerTxnId: string | null } | null;
  /** tickets exist from the start (unpaid) but are only handed out once the order is paid */
  tickets: Array<{ ref: string; typeNameEn: string; typeNameAr: string; status: Ticket['status'] }>;
}

export function orderView(order: OrderRow, isMock: boolean): OrderView {
  const latest = order.payments[0] ?? null;
  const itemOf = new Map(order.items.map((i) => [i.id, i]));
  return {
    orderNumber: order.orderNumber, status: order.status, visitDate: dateToIso(order.visitDate), dayType: dayTypeOf(dateToIso(order.visitDate)), currency: order.currency,
    totalMinor: order.totalMinor, expiresAt: order.expiresAt, paidAt: order.paidAt, createdAt: order.createdAt,
    customer: order.customer ? { fullName: order.customer.fullName, email: order.customer.email } : null,
    items: order.items.map((i) => ({
      typeNameEn: i.typeNameEn, typeNameAr: i.typeNameAr, audienceNameEn: i.audienceNameEn, audienceNameAr: i.audienceNameAr,
      unitPriceMinor: i.unitPriceMinor, quantity: i.quantity, lineTotalMinor: i.lineTotalMinor,
    })),
    payment: latest ? { status: latest.status, provider: latest.provider, isMock, providerTxnId: latest.status === 'PENDING' ? latest.providerTxnId : null } : null,
    tickets:
      order.status === 'PAID'
        ? order.tickets.map((t) => ({ ref: t.publicRef, typeNameEn: itemOf.get(t.orderItemId)?.typeNameEn ?? '', typeNameAr: itemOf.get(t.orderItemId)?.typeNameAr ?? '', status: t.status }))
        : [],
  };
}
