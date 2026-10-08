import { ScanReason } from '@prisma/client';
import { ScanVerdict } from '../ticketing/rules/scan-validity';

/**
 * What the gate scanner is told. These are the machine-readable codes; the portal turns each into a large, plain
 * message. The wording here is safe to show: it says what happened to the TICKET and never how the code is checked.
 */
export const SCAN_RESULTS = [
  'ACCESS_GRANTED',
  'INVALID_QR',
  'INVALID_SIGNATURE',
  'RETIRED_KEY',
  'TICKET_NOT_FOUND',
  'TICKET_NOT_VALID',
  'ALREADY_USED',
  'WRONG_DATE',
  'CANCELLED',
  'EXPIRED',
] as const;
export type ScanResultCode = (typeof SCAN_RESULTS)[number];

/** The coarse reason kept in `ticket_scans.reason` (an enum that predates Phase 8 and is unchanged). */
export const REASON_OF: Record<ScanResultCode, ScanReason> = {
  ACCESS_GRANTED: 'OK',
  INVALID_QR: 'INVALID_TOKEN',
  INVALID_SIGNATURE: 'INVALID_TOKEN',
  RETIRED_KEY: 'INVALID_TOKEN',
  TICKET_NOT_FOUND: 'NOT_FOUND',
  TICKET_NOT_VALID: 'NOT_PAID',
  ALREADY_USED: 'ALREADY_USED',
  WRONG_DATE: 'WRONG_DATE',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
};

export const MESSAGE_OF: Record<ScanResultCode, string> = {
  ACCESS_GRANTED: 'Access granted.',
  INVALID_QR: 'This is not a valid Al-Azhar Park ticket.',
  INVALID_SIGNATURE: 'This is not a valid Al-Azhar Park ticket.',
  RETIRED_KEY: 'This ticket was issued with a code that is no longer accepted.',
  TICKET_NOT_FOUND: 'No ticket was found for this code.',
  TICKET_NOT_VALID: 'This ticket is not valid (the order is not paid).',
  ALREADY_USED: 'This ticket has already been used.',
  WRONG_DATE: 'This ticket is not valid today.',
  CANCELLED: 'This ticket was cancelled.',
  EXPIRED: 'This ticket has expired.',
};

/** The lifecycle verdict (the readable specification in rules/scan-validity.ts) as a scanner result. */
export const CODE_OF_VERDICT: Record<Exclude<ScanVerdict, 'OK'>, ScanResultCode> = {
  NOT_PAID: 'TICKET_NOT_VALID',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  ALREADY_USED: 'ALREADY_USED',
  WRONG_DATE: 'WRONG_DATE',
};
