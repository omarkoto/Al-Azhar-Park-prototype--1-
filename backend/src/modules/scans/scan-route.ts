import { ExecutionContext, SetMetadata } from '@nestjs/common';

export const SCAN_ROUTE = 'throttle:scan';

/** Marks the gate-scan route: it is counted by the scanner's own, higher and configurable limit instead of the general one. */
export const ScanRoute = () => SetMetadata(SCAN_ROUTE, true);

export const isScanRoute = (context: ExecutionContext): boolean => Reflect.getMetadata(SCAN_ROUTE, context.getHandler()) === true;
