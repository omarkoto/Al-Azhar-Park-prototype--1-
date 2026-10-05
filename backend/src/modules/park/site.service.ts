import { Injectable } from '@nestjs/common';
import { addDays, parkDateOf } from '../ticketing/rules/calendar';
import { resolveHours, SpecialHours as RuleSpecial, WeeklyHours } from '../ticketing/rules/opening-hours';
import { minutesToHhmm } from '../ticketing/rules/calendar';
import { HoursService, SpecialView } from './hours.service';
import { ContactView, ParkService, ParkView } from './park.service';

export interface TodayView {
  date: string;
  isClosed: boolean;
  opens: string | null;
  closes: string | null;
  /** the special period that changes today's hours, if any */
  special: Pick<SpecialView, 'kind' | 'labelEn' | 'labelAr' | 'noteEn' | 'noteAr'> | null;
}

export interface SiteSnapshot {
  park: Omit<ParkView, 'updatedAt'>;
  contact: Omit<ContactView, 'updatedAt'>;
  hours: {
    weekly: Array<{ dayOfWeek: number; isClosed: boolean; opens: string | null; closes: string | null }>;
    /** active special periods that end today or later, within the next year */
    special: Omit<SpecialView, 'id' | 'isActive' | 'priority'>[];
    today: TodayView;
  };
  updatedAt: string;
}

/** What the public website reads: park information, contact details and opening hours in one small response. */
@Injectable()
export class SiteService {
  constructor(
    private readonly park: ParkService,
    private readonly hours: HoursService,
  ) {}

  async snapshot(now: Date = new Date()): Promise<SiteSnapshot> {
    const [park, contact, weekly, upcoming] = await Promise.all([
      this.park.getPark(), this.park.getContact(), this.hours.getWeekly(), this.hours.listSpecial('upcoming'),
    ]);
    const today = parkDateOf(now);
    const horizon = addDays(today, 365);
    const special = upcoming.filter((s) => s.isActive && s.dateFrom <= horizon);

    const rule = resolveHours(today, weekly as WeeklyHours[], special as unknown as RuleSpecial[]);
    const covering = special
      .filter((s) => s.dateFrom <= today && today <= s.dateTo)
      .sort((a, b) => b.priority - a.priority || (a.dateFrom < b.dateFrom ? 1 : -1))[0];

    const { updatedAt: parkUpdated, ...parkPublic } = park;
    const { updatedAt: contactUpdated, ...contactPublic } = contact;
    return {
      park: parkPublic,
      contact: contactPublic,
      hours: {
        weekly,
        special: special.map(({ id: _id, isActive: _a, priority: _p, ...rest }) => rest),
        today: {
          date: today,
          isClosed: rule.isClosed,
          opens: rule.opensMinutes === null ? null : minutesToHhmm(rule.opensMinutes),
          closes: rule.closesMinutes === null ? null : minutesToHhmm(rule.closesMinutes),
          special: covering ? { kind: covering.kind, labelEn: covering.labelEn, labelAr: covering.labelAr, noteEn: covering.noteEn, noteAr: covering.noteAr } : null,
        },
      },
      updatedAt: new Date(Math.max(parkUpdated.getTime(), contactUpdated.getTime())).toISOString(),
    };
  }
}
