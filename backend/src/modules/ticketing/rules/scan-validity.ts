import { parkDateOf } from './calendar';

/** Reasons a scan can be refused. (The database enum also has NOT_FOUND / INVALID_TOKEN for unknown codes.) */
export type ScanVerdict = 'OK' | 'NOT_PAID' | 'CANCELLED' | 'EXPIRED' | 'ALREADY_USED' | 'WRONG_DATE';

export interface ScannableTicket {
  status: 'PENDING' | 'VALID' | 'USED' | 'CANCELLED' | 'EXPIRED';
  /** YYYY-MM-DD — the date chosen at purchase */
  visitDate: string;
}

/**
 * Would this ticket be admitted at this instant?
 * A ticket is valid ONLY on its visit date (Cairo calendar day): a ticket for 10 October scanned on
 * 11 October — even one second after midnight — is refused. The scan service (Phase 8) enforces the same
 * rule inside the atomic database statement (`visit_date = azharpark_date_of(now())`); this function is
 * the readable specification of it, and the tests check the two agree.
 */
export function evaluateScan(ticket: ScannableTicket, scannedAt: Date): ScanVerdict {
  switch (ticket.status) {
    case 'USED':
      return 'ALREADY_USED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'PENDING':
      return 'NOT_PAID';
    case 'VALID':
      return ticket.visitDate === parkDateOf(scannedAt) ? 'OK' : 'WRONG_DATE';
  }
}
