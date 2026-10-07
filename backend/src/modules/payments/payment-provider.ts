import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppException } from '../../common/errors/app-exception';

export interface ChargeRequest {
  orderNumber: string;
  amountMinor: number;
  currency: string;
  description: string;
}

/** What the customer's browser is told to do next. */
export interface ChargeInstruction {
  /** the provider's own id for this payment attempt; it is how the provider's confirmation finds the payment */
  providerTxnId: string;
  /** where to send the customer to pay (a hosted payment page). null for the development stand-in. */
  redirectUrl: string | null;
}

/**
 * The seam between ordering and any payment company. The order logic only ever:
 *   1. asks a provider to START a payment for an exact amount (createCharge), and
 *   2. later hears the provider's CONFIRMATION through PaymentsService.confirm(), which re-checks the order,
 *      the amount and the state before anything becomes paid.
 * A provider can therefore never change an order's total or mark a different order as paid.
 *
 * Adding Paymob (or another provider) means one more subclass here plus a webhook endpoint that verifies the
 * provider's signature and then calls PaymentsService.confirm(); no order code changes.
 */
export abstract class PaymentProvider {
  /** stored on the payment row, e.g. MOCK or PAYMOB */
  abstract readonly code: string;
  /** true for stand-ins that must never exist in production */
  abstract readonly developmentOnly: boolean;
  abstract createCharge(request: ChargeRequest): Promise<ChargeInstruction>;
}

/**
 * DEVELOPMENT ONLY. Starts a fake payment so the whole purchase flow can be exercised end to end. Nothing is
 * charged; a tester presses "pay" or "fail" on the confirmation page. It is only ever selected outside production
 * (the configuration refuses it there).
 */
@Injectable()
export class MockPaymentProvider extends PaymentProvider {
  readonly code = 'MOCK';
  readonly developmentOnly = true;

  async createCharge(): Promise<ChargeInstruction> {
    return { providerTxnId: `mock_${randomUUID()}`, redirectUrl: null };
  }
}

/** Online payment switched off (production before a real provider exists): orders cannot be started. */
@Injectable()
export class DisabledPaymentProvider extends PaymentProvider {
  readonly code = 'NONE';
  readonly developmentOnly = false;

  async createCharge(): Promise<ChargeInstruction> {
    throw new AppException('PAYMENT_NOT_AVAILABLE', 'Online payment is not available yet.', 503);
  }
}
