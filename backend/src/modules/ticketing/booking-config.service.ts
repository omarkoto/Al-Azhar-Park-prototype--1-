import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { dateToIso, timeToHhmm } from './rules/calendar';
import { parseCapacityLimit } from './rules/capacity';
import { SpecialHours, WeeklyHours } from './rules/opening-hours';
import { SalesPolicy } from './rules/sales-window';

export interface BookingConfig {
  weekly: WeeklyHours[];
  special: SpecialHours[];
  policy: SalesPolicy;
  /** minutes an unpaid online order stays valid */
  pendingExpiryMinutes: number;
  /** most tickets one online order may hold */
  maxTicketsPerOrder: number;
  /** null = unlimited */
  capacityLimit: number | null;
  privacyNoticeVersion: string | null;
}

const positiveInt = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : fallback);

/**
 * Everything the purchase rules need from the database in one read: the park's weekly and special hours and the
 * booking settings. Nothing here is a constant of the rules — hours and numbers come from the same tables the
 * portal edits, so changing them changes the sales rules immediately.
 */
@Injectable()
export class BookingConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async load(db: Pick<PrismaService, 'openingHour' | 'specialHours' | 'systemSetting'> = this.prisma): Promise<BookingConfig> {
    const [weeklyRows, specialRows, settingRows] = await Promise.all([
      db.openingHour.findMany(),
      db.specialHours.findMany({ where: { isActive: true } }),
      db.systemSetting.findMany({ where: { key: { in: ['booking.maxAdvanceDays', 'booking.sameDayCutoffMinutesBeforeClose', 'booking.maxTicketsPerOrder', 'orders.pendingExpiryMinutes', 'capacity.dailyLimit', 'privacy.noticeVersion'] } } }),
    ]);
    const setting = new Map(settingRows.map((s) => [s.key, s.value as unknown]));
    const cutoff = setting.get('booking.sameDayCutoffMinutesBeforeClose');
    return {
      weekly: weeklyRows.map((w) => ({ dayOfWeek: w.dayOfWeek, isClosed: w.isClosed, opens: w.opens ? timeToHhmm(w.opens) : null, closes: w.closes ? timeToHhmm(w.closes) : null })),
      special: specialRows.map((s) => ({
        dateFrom: dateToIso(s.dateFrom), dateTo: dateToIso(s.dateTo), isClosed: s.isClosed, priority: s.priority, isActive: s.isActive,
        opens: s.opens ? timeToHhmm(s.opens) : null, closes: s.closes ? timeToHhmm(s.closes) : null,
      })),
      policy: {
        maxAdvanceDays: positiveInt(setting.get('booking.maxAdvanceDays'), 90),
        sameDayCutoffMinutesBeforeClose: typeof cutoff === 'number' && Number.isInteger(cutoff) && cutoff >= 0 ? cutoff : 60,
      },
      pendingExpiryMinutes: positiveInt(setting.get('orders.pendingExpiryMinutes'), 30),
      maxTicketsPerOrder: positiveInt(setting.get('booking.maxTicketsPerOrder'), 50),
      capacityLimit: parseCapacityLimit(setting.get('capacity.dailyLimit') ?? null),
      privacyNoticeVersion: typeof setting.get('privacy.noticeVersion') === 'string' ? (setting.get('privacy.noticeVersion') as string) : null,
    };
  }
}
