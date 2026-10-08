import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * What the scanner sends: the text read from the QR code and the gate it is working at. Nothing else is accepted, and
 * nothing the client could claim about the ticket (date, price, status) is read.
 */
export const scanSchema = z
  .object({
    qr: z.string().trim().min(1, 'scan or type the code').max(512, 'that is too long to be a ticket code'),
    gateId: z.string().uuid(),
  })
  .strict();
export class ScanDto extends createZodDto(scanSchema) {}
