import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const name = z.string().trim().min(2).max(60);
const description = z
  .union([z.string().trim().max(300), z.null()])
  .optional()
  .transform((v) => (v ? v : null));
const permissionCodes = z
  .array(z.string().regex(/^[a-z][a-z-]*:[a-z_]+$/, 'must look like resource:action'))
  .max(200)
  .transform((codes) => [...new Set(codes)]);

export class CreateRoleDto extends createZodDto(
  z.object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/, 'must be UPPER_SNAKE_CASE, e.g. EVENT_COORDINATOR'),
    name,
    description,
    permissionCodes,
  }),
) {}

export class UpdateRoleDto extends createZodDto(z.object({ name, description })) {}

export class SetRolePermissionsDto extends createZodDto(z.object({ permissionCodes })) {}
