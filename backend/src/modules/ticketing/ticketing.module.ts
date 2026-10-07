import { Module } from '@nestjs/common';
import { Clock, SystemClock } from '../../common/clock';
import { AppConfigService } from '../../config/app-config.service';
import { DisabledPaymentProvider, MockPaymentProvider, PaymentProvider } from '../payments/payment-provider';
import { PaymentsService } from '../payments/payments.service';
import { BookingConfigService } from './booking-config.service';
import { OrderExpiryScheduler } from './order-expiry.scheduler';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrdersService } from './orders.service';
import { PricesService } from './prices.service';
import { PurchaseService } from './purchase.service';
import { TicketTypesService } from './ticket-types.service';
import { PublicTicketingController, TicketingAdminController } from './ticketing.controller';

@Module({
  controllers: [PublicTicketingController, TicketingAdminController],
  providers: [
    { provide: Clock, useClass: SystemClock },
    {
      provide: PaymentProvider,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService): PaymentProvider => (config.paymentProvider === 'mock' ? new MockPaymentProvider() : new DisabledPaymentProvider()),
    },
    BookingConfigService, OrderLifecycleService, OrderExpiryScheduler, PaymentsService, PurchaseService, OrdersService, TicketTypesService, PricesService,
  ],
  exports: [Clock],
})
export class TicketingModule {}
