import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { paginationQuerySchema } from '../../common/dto/pagination';

const roleCode = z.string().regex(/^[A-Z][A-Z0-9_]{1,49}$/, 'must be a role code such as TICKET_STAFF');
const roleCodes = z.array(roleCode).min(1, 'a user needs at least one role').max(10);

export class ListUsersQueryDto extends createZodDto(
  paginationQuerySchema.extend({
    isActive: z.enum(['true', 'false']).optional(),
    role: roleCode.optional(),
  }),
) {}

export class CreateUserDto extends createZodDto(
  z.object({
    email: z.string().trim().toLowerCase().email().max(254),
    fullName: z.string().trim().min(2).max(120),
    roleCodes,
  }),
) {}

export class UpdateUserDto extends createZodDto(z.object({ fullName: z.string().trim().min(2).max(120) })) {}

export class SetRolesDto extends createZodDto(z.object({ roleCodes })) {}
