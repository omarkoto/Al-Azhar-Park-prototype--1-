import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';

export interface PasswordLinkMessage {
  email: string;
  fullName: string;
  /** the one-time secret. It is delivered to the person, never stored in plain text, never logged in production. */
  token: string;
  expiresAt: Date;
  purpose: 'reset' | 'invite';
}

/**
 * How a password link reaches a person. Kept behind an abstraction so the e-mail provider can be chosen later
 * (notifications phase) without touching authentication: rebind it in AuthModule.
 */
export abstract class PasswordLinkNotifier {
  abstract send(message: PasswordLinkMessage): Promise<void>;
}

/**
 * Default until an e-mail provider is configured. In development/test it logs the token so the flow can be
 * exercised; in production it logs only that a message was due (no secret), so a missing provider is visible.
 */
@Injectable()
export class LoggingPasswordLinkNotifier extends PasswordLinkNotifier {
  private readonly logger = new Logger('PasswordLinkNotifier');

  constructor(private readonly config: AppConfigService) {
    super();
  }

  async send(message: PasswordLinkMessage): Promise<void> {
    if (this.config.isProduction) {
      this.logger.warn(`No e-mail provider configured: a "${message.purpose}" link was NOT delivered.`);
      return;
    }
    this.logger.log(`[dev only] ${message.purpose} token for ${message.email}: ${message.token}`);
  }
}
