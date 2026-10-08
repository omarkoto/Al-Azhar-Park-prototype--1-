import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { OrderLifecycleService } from './order-lifecycle.service';
import { TicketDeliveryService } from './ticket-delivery.service';

const SWEEP_EVERY_MS = 60_000;

/**
 * Once a minute, expires unpaid orders that are past their deadline. Reads and payment confirmations also expire
 * an order the moment they meet it, so this sweep only keeps capacity and the portal tidy; correctness never
 * depends on it. It does not run under test (tests call the lifecycle directly, with a controlled clock).
 */
@Injectable()
export class OrderExpiryScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('OrderExpiry');
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly lifecycle: OrderLifecycleService,
    private readonly delivery: TicketDeliveryService,
    private readonly config: AppConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('NODE_ENV') === 'test') return;
    this.timer = setInterval(() => {
      this.lifecycle.expireAllDue().then(
        (n) => n > 0 && this.log.log(`expired ${n} unpaid order(s)`),
        (e: unknown) => this.log.error(`sweep failed: ${String(e)}`),
      );
      // failed ticket e-mails whose retry time has come
      this.delivery.retryDue().then(
        (n) => n > 0 && this.log.log(`retried ${n} e-mail(s)`),
        (e: unknown) => this.log.error(`e-mail retry failed: ${String(e)}`),
      );
    }, SWEEP_EVERY_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
