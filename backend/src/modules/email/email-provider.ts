import { Injectable, Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { AppException } from '../../common/errors/app-exception';
import { AppConfigService } from '../../config/app-config.service';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * The seam between the park's messages and a mail service. Whoever sends mail (ticket confirmations today, other
 * notifications later) talks to this; choosing or changing the mail service never touches them.
 * `send` must throw when the message was not accepted, so the caller can record the failure and retry.
 */
export abstract class EmailProvider {
  abstract readonly code: string;
  abstract send(message: EmailMessage): Promise<void>;
}

/**
 * DEVELOPMENT ONLY: nothing is sent; the message is written to the log so the flow can be tried end to end.
 * The configuration refuses it in production.
 */
@Injectable()
export class LogEmailProvider extends EmailProvider {
  readonly code = 'LOG';
  private readonly logger = new Logger('Email[dev]');

  async send(message: EmailMessage): Promise<void> {
    this.logger.log(`to ${message.to} — ${message.subject}\n${message.text}`);
  }
}

/** Production without a mail service configured: sending fails visibly, and the message stays in the outbox for retry. */
@Injectable()
export class DisabledEmailProvider extends EmailProvider {
  readonly code = 'NONE';

  async send(): Promise<void> {
    throw new AppException('EMAIL_NOT_CONFIGURED', 'No e-mail provider is configured.', 503);
  }
}

/** Sends through any SMTP service (EMAIL_SMTP_URL). The URL holds the credentials and is never logged. */
@Injectable()
export class SmtpEmailProvider extends EmailProvider {
  readonly code = 'SMTP';
  private readonly transport;
  private readonly from: string;

  constructor(config: AppConfigService) {
    super();
    this.transport = createTransport(config.get('EMAIL_SMTP_URL') as string);
    this.from = config.get('EMAIL_FROM') as string;
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text, html: message.html });
  }
}
