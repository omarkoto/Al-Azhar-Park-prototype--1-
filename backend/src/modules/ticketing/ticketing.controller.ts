import { Body, Controller, Get, Header, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AppException } from '../../common/errors/app-exception';
import { SkipEnvelope } from '../../common/http/envelope';
import { RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser, Public, RequestCtx, RequirePermissions } from '../auth/decorators';
import { PaymentsService } from '../payments/payments.service';
import { OrdersService } from './orders.service';
import { PricesService } from './prices.service';
import { IDEMPOTENCY_KEY_MESSAGE, PurchaseService } from './purchase.service';
import { TicketTypesService } from './ticket-types.service';
import {
  CancelOrderDto, CatalogQueryDto, TicketPdfQueryDto, CreateOrderDto, CreatePriceDto, CreateTicketTypeDto, ListOrdersQueryDto, ListPricesQueryDto, MockCompleteDto, OrderIdsDto, QuoteDto, SetPriceActiveDto,
  UpdateTicketTypeDto,
} from './ticketing.dto';

const MINUTE = 60_000;
/** Per-address limits, scaled like the sign-in limits by AUTH_RATE_LIMIT_MULTIPLIER (the browser tests; production refuses a value above 1). */
const limit = (base: number) => () => base * Math.max(1, Number(process.env.AUTH_RATE_LIMIT_MULTIPLIER) || 1);

/** What the public website calls to see prices and buy tickets. No login; the order's own secret key guards each order. */
@ApiTags('public tickets')
@Controller('public')
export class PublicTicketingController {
  constructor(
    private readonly purchase: PurchaseService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
  ) {}

  @Public()
  @Get('tickets/catalog')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Ticket types, audiences, booking rules and — for ?date= — opening hours, availability and prices' })
  catalog(@Query() query: CatalogQueryDto) {
    return this.purchase.catalog(query.date);
  }

  @Public()
  @Post('orders/quote')
  @HttpCode(200)
  @Throttle({ default: { limit: limit(60), ttl: MINUTE } })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Price a selection. The server decides every amount; the request only names date, audience and quantities.' })
  quote(@Body() dto: QuoteDto) {
    return this.purchase.quote(dto);
  }

  @Public()
  @Post('orders')
  @Throttle({ default: { limit: limit(10), ttl: MINUTE } })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Create an order (unpaid for the next minutes) and start its payment. Send an Idempotency-Key to make retries safe.' })
  async create(
    @Body() dto: CreateOrderDto,
    @Headers('idempotency-key') key: string | undefined,
    @RequestCtx() ctx: RequestContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    // shape only: keys of 8–15 characters (accepted before Phase 11) can still REPLAY an order they created; a new order needs 16+ (see PurchaseService)
    if (key !== undefined && !/^[A-Za-z0-9_-]{8,100}$/.test(key)) throw new AppException('INVALID_IDEMPOTENCY_KEY', IDEMPOTENCY_KEY_MESSAGE, 400);
    const { replayed, ...created } = await this.purchase.createOrder(dto, key, ctx);
    res.status(replayed ? 200 : 201);
    return created;
  }

  @Public()
  @Get('orders/:orderNumber')
  @Throttle({ default: { limit: limit(60), ttl: MINUTE } })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Your order, with the access key given when it was created (header X-Order-Token)' })
  order(@Param('orderNumber') orderNumber: string, @Headers('x-order-token') token: string | undefined) {
    return this.orders.getForCustomer(orderNumber, token);
  }

  @Public()
  @Get('orders/:orderNumber/tickets/pdf')
  @SkipEnvelope()
  @Throttle({ default: { limit: limit(30), ttl: MINUTE } })
  @ApiOperation({ summary: 'All the tickets of your paid order as one PDF (header X-Order-Token). ?lang=en|ar' })
  async allTicketsPdf(@Param('orderNumber') orderNumber: string, @Headers('x-order-token') token: string | undefined, @Query() query: TicketPdfQueryDto, @Res({ passthrough: true }) res: Response) {
    return this.sendPdf(res, await this.orders.ticketsPdf(orderNumber, token, { lang: query.lang }));
  }

  @Public()
  @Get('orders/:orderNumber/tickets/:ref/pdf')
  @SkipEnvelope()
  @Throttle({ default: { limit: limit(30), ttl: MINUTE } })
  @ApiOperation({ summary: 'One ticket of your paid order as a PDF (header X-Order-Token). ?lang=en|ar' })
  async oneTicketPdf(@Param('orderNumber') orderNumber: string, @Param('ref') ref: string, @Headers('x-order-token') token: string | undefined, @Query() query: TicketPdfQueryDto, @Res({ passthrough: true }) res: Response) {
    if (!/^TKT-[0-9A-Z]{8,16}$/.test(ref)) throw new AppException('TICKET_NOT_FOUND', 'Ticket not found.', 404);
    return this.sendPdf(res, await this.orders.ticketsPdf(orderNumber, token, { ref, lang: query.lang }));
  }

  /** Tickets are private: never stored by a shared cache, and always offered as a download. */
  private sendPdf(res: Response, pdf: { filename: string; data: Buffer }): StreamableFile {
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${pdf.filename}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    return new StreamableFile(pdf.data);
  }

  @Public()
  @Post('orders/:orderNumber/payments')
  @HttpCode(200)
  @Throttle({ default: { limit: limit(10), ttl: MINUTE } })
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Start (or resume) payment for your unpaid order, for example after a failed attempt' })
  pay(@Param('orderNumber') orderNumber: string, @Headers('x-order-token') token: string | undefined) {
    return this.orders.payAgain(orderNumber, token);
  }

  /** DEVELOPMENT ONLY: the stand-in payment page's "pay" and "fail" buttons. It does not exist when the mock provider is off. */
  @Public()
  @Post('payments/mock/:txnId/complete')
  @HttpCode(200)
  @Throttle({ default: { limit: limit(30), ttl: MINUTE } })
  @ApiOperation({ summary: 'Development only: complete or fail a mock payment' })
  mockComplete(@Param('txnId') txnId: string, @Body() dto: MockCompleteDto, @RequestCtx() ctx: RequestContext) {
    if (!this.payments.isMock) throw new AppException('NOT_FOUND', 'Not found.', 404);
    return this.payments.confirm({ provider: this.payments.providerCode, providerTxnId: txnId, ...dto }, ctx);
  }
}

@ApiTags('ticketing')
@ApiBearerAuth()
@Controller()
export class TicketingAdminController {
  constructor(
    private readonly types: TicketTypesService,
    private readonly prices: PricesService,
    private readonly orders: OrdersService,
  ) {}

  // ── ticket types ──

  @Get('ticket-types')
  @RequirePermissions('ticket-types:read')
  @ApiOperation({ summary: 'Ticket types with how often each was sold' })
  listTypes() {
    return this.types.list();
  }

  @Get('ticket-audiences')
  @RequirePermissions('ticket-types:read')
  audiences() {
    return this.types.audiences();
  }

  @Put('ticket-types/order')
  @RequirePermissions('ticket-types:write')
  typeOrder(@Body() dto: OrderIdsDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.types.setOrder(dto.ids, actor, ctx);
  }

  @Post('ticket-types')
  @RequirePermissions('ticket-types:write')
  createType(@Body() dto: CreateTicketTypeDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.types.create(dto, actor, ctx);
  }

  @Put('ticket-types/:id')
  @RequirePermissions('ticket-types:write')
  updateType(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTicketTypeDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.types.update(id, dto, actor, ctx);
  }

  // ── prices ──

  @Get('prices')
  @RequirePermissions('pricing:read')
  @ApiOperation({ summary: 'Every price row, with its status (current, upcoming, ended, inactive)' })
  listPrices(@Query() query: ListPricesQueryDto) {
    return this.prices.list(query);
  }

  @Get('prices/current')
  @RequirePermissions('pricing:read')
  @ApiOperation({ summary: 'What a visitor pays now, per audience and ticket type (weekday and weekend)' })
  currentPrices() {
    return this.prices.current();
  }

  @Post('prices')
  @RequirePermissions('pricing:write')
  @ApiOperation({ summary: 'Add a new price from a future date. The previous price ends the day before; history is never edited.' })
  createPrice(@Body() dto: CreatePriceDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.prices.create(dto, actor, ctx);
  }

  @Put('prices/:id/active')
  @RequirePermissions('pricing:write')
  setPriceActive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetPriceActiveDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.prices.setActive(id, dto.isActive, actor, ctx);
  }

  // ── orders ──

  @Get('orders')
  @RequirePermissions('orders:read')
  @ApiOperation({ summary: 'Orders (filter: status, visitDate, channel, search)' })
  listOrders(@Query() query: ListOrdersQueryDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.orders.list(query, actor);
  }

  @Get('orders/:id')
  @RequirePermissions('orders:read')
  getOrder(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.orders.get(id, actor);
  }

  @Post('orders/:id/resend-email')
  @HttpCode(200)
  @RequirePermissions('tickets:resend')
  @Throttle({ default: { limit: 20, ttl: MINUTE } })
  @ApiOperation({ summary: 'Send the ticket e-mail of a paid order again (audited)' })
  resendEmail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.orders.resendEmail(id, actor, ctx);
  }

  @Post('orders/:id/tickets/:ref/cancel')
  @HttpCode(200)
  @RequirePermissions('tickets:cancel')
  @ApiOperation({ summary: 'Cancel one ticket for an operational reason. This is not a refund.' })
  cancelTicket(@Param('id', ParseUUIDPipe) id: string, @Param('ref') ref: string, @Body() dto: CancelOrderDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.orders.cancelTicket(id, ref, dto.reason, actor, ctx);
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('orders:cancel')
  @ApiOperation({ summary: 'Cancel an order for an operational reason. This is not a refund.' })
  cancelOrder(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelOrderDto, @CurrentUser() actor: AuthenticatedUser, @RequestCtx() ctx: RequestContext) {
    return this.orders.cancel(id, dto.reason, actor, ctx);
  }
}
