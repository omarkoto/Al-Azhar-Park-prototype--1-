import { Injectable } from '@nestjs/common';

/** "What time is it?" as a dependency, so the date rules (same-day cut-off, order expiry) can be tested exactly. */
export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}
