import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PASSWORD_MAX } from './password-policy';

const email = z.string().trim().min(3).max(254);
/** Strength is judged by passwordProblem() (it needs the person's name/email); here only a hard size bound. */
const newPassword = z.string().min(1).max(PASSWORD_MAX + 1);

export class LoginDto extends createZodDto(z.object({ email, password: z.string().min(1).max(1024) })) {}

export class RefreshDto extends createZodDto(z.object({ refreshToken: z.string().min(20).max(200).optional() })) {}

export class ChangePasswordDto extends createZodDto(
  z.object({ currentPassword: z.string().min(1).max(1024), newPassword }),
) {}

export class ForgotPasswordDto extends createZodDto(z.object({ email })) {}

export class ResetPasswordDto extends createZodDto(z.object({ token: z.string().min(20).max(200), newPassword })) {}
