import { auditActionFor, canTransition, EVENT_STATUSES, isPublic, TRANSITIONS } from './event-status';
import { describeEventTimes, EventTimeError, resolveEventTimes } from './event-time';

describe('event status lifecycle', () => {
  it('lets only COMING_SOON and PUBLISHED be seen by the public', () => {
    expect(EVENT_STATUSES.filter(isPublic)).toEqual(['COMING_SOON', 'PUBLISHED']);
  });

  it('allows exactly the planned transitions', () => {
    expect(TRANSITIONS.DRAFT).toEqual(['COMING_SOON', 'PUBLISHED', 'ARCHIVED']);
    expect(canTransition('COMING_SOON', 'PUBLISHED')).toBe(true);
    expect(canTransition('PUBLISHED', 'COMING_SOON')).toBe(true);
    expect(canTransition('PUBLISHED', 'CANCELLED')).toBe(true);
    expect(canTransition('CANCELLED', 'DRAFT')).toBe(true);
    expect(canTransition('ARCHIVED', 'DRAFT')).toBe(true);
  });

  it('never sends a cancelled or archived event straight back to the public', () => {
    for (const from of ['CANCELLED', 'ARCHIVED'] as const) {
      expect(canTransition(from, 'PUBLISHED')).toBe(false);
      expect(canTransition(from, 'COMING_SOON')).toBe(false);
    }
    expect(canTransition('ARCHIVED', 'CANCELLED')).toBe(false);
    expect(canTransition('DRAFT', 'CANCELLED')).toBe(false); // a draft was never announced: archive it instead
  });

  it('never allows a no-op change', () => {
    for (const s of EVENT_STATUSES) expect(canTransition(s, s)).toBe(false);
  });

  it('names the audit event after what happened', () => {
    expect(auditActionFor('DRAFT', 'PUBLISHED')).toBe('event.published');
    expect(auditActionFor('DRAFT', 'COMING_SOON')).toBe('event.coming_soon');
    expect(auditActionFor('PUBLISHED', 'CANCELLED')).toBe('event.cancelled');
    expect(auditActionFor('PUBLISHED', 'ARCHIVED')).toBe('event.archived');
    expect(auditActionFor('PUBLISHED', 'DRAFT')).toBe('event.unpublished');
    expect(auditActionFor('ARCHIVED', 'DRAFT')).toBe('event.restored');
    expect(auditActionFor('CANCELLED', 'DRAFT')).toBe('event.restored');
  });
});

describe('event times', () => {
  const iso = (d: Date | null) => d?.toISOString();

  it('turns a Cairo evening into the right instants (winter, UTC+2)', () => {
    const t = resolveEventTimes({ date: '2026-12-04', startTime: '10:00', endTime: '18:00' });
    expect(iso(t.startsAt)).toBe('2026-12-04T08:00:00.000Z');
    expect(iso(t.endsAt)).toBe('2026-12-04T16:00:00.000Z');
    expect(t.crossesMidnight).toBe(false);
  });

  it('is daylight-saving correct in summer (UTC+3)', () => {
    expect(iso(resolveEventTimes({ date: '2026-07-10', startTime: '20:00', endTime: '23:00' }).startsAt)).toBe('2026-07-10T17:00:00.000Z');
  });

  it('lets an event run past midnight: 20:00 – 01:00 ends the next day', () => {
    const t = resolveEventTimes({ date: '2026-11-20', startTime: '20:00', endTime: '01:00' });
    expect(t.crossesMidnight).toBe(true);
    expect(iso(t.startsAt)).toBe('2026-11-20T18:00:00.000Z');
    expect(iso(t.endsAt)).toBe('2026-11-20T23:00:00.000Z'); // 01:00 on the 21st in Cairo
    expect(describeEventTimes(t.startsAt, t.endsAt)).toEqual({ date: '2026-11-20', startTime: '20:00', endTime: '01:00', crossesMidnight: true });
  });

  it('keeps the event on the day it starts, whatever the visitor’s own time zone', () => {
    const t = resolveEventTimes({ date: '2026-11-20', startTime: '23:30', endTime: '02:00' });
    expect(describeEventTimes(t.startsAt, t.endsAt).date).toBe('2026-11-20');
  });

  it('round-trips every kind of event', () => {
    for (const [s, e] of [['09:00', '17:30'], ['20:00', '01:00'], ['00:00', '06:00'], ['23:59', '00:30']] as const) {
      const t = resolveEventTimes({ date: '2027-03-05', startTime: s, endTime: e });
      expect(describeEventTimes(t.startsAt, t.endsAt)).toMatchObject({ date: '2027-03-05', startTime: s, endTime: e });
    }
  });

  it('treats an event with no times as a date-only event', () => {
    const t = resolveEventTimes({ date: '2026-12-04' });
    expect(iso(t.startsAt)).toBe('2026-12-03T22:00:00.000Z'); // midnight in Cairo
    expect(t.endsAt).toBeNull();
    expect(describeEventTimes(t.startsAt, t.endsAt)).toEqual({ date: '2026-12-04', startTime: null, endTime: null, crossesMidnight: false });
  });

  it('refuses a lone start or end, equal times and anything over 18 hours', () => {
    const problem = (input: Parameters<typeof resolveEventTimes>[0]) => {
      try {
        resolveEventTimes(input);
        return null;
      } catch (e) {
        return e instanceof EventTimeError ? e.problem : 'OTHER';
      }
    };
    expect(problem({ date: '2026-12-04', startTime: '10:00' })).toBe('TIMES_TOGETHER');
    expect(problem({ date: '2026-12-04', endTime: '10:00' })).toBe('TIMES_TOGETHER');
    expect(problem({ date: '2026-12-04', startTime: '10:00', endTime: '10:00' })).toBe('SAME_TIME');
    expect(problem({ date: '2026-12-04', startTime: '06:00', endTime: '05:00' })).toBe('TOO_LONG'); // 23 hours
  });

  it('accepts exactly 18 hours but not a minute more', () => {
    expect(resolveEventTimes({ date: '2026-12-04', startTime: '06:00', endTime: '00:00' }).crossesMidnight).toBe(true);
    expect(() => resolveEventTimes({ date: '2026-12-04', startTime: '06:00', endTime: '00:01' })).toThrow(EventTimeError);
  });

  it('is correct across the daylight-saving changes', () => {
    // clocks go back at the end of Thursday 29 Oct 2026: an evening starting that day lasts an hour longer in real time
    const back = resolveEventTimes({ date: '2026-10-29', startTime: '20:00', endTime: '01:00' });
    expect((back.endsAt!.getTime() - back.startsAt.getTime()) / 3_600_000).toBe(6);
    // and a skipped wall-clock time is refused with a clear problem
    expect(() => resolveEventTimes({ date: '2026-04-24', startTime: '00:30', endTime: '03:00' })).toThrow(/does not exist/);
  });
});
