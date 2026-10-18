import { Injectable, Logger } from '@nestjs/common';
import { EmailProvider } from '../email/email-provider';
import { ContactMessageDto } from './park.dto';

/** Where messages from the website's contact form are delivered. */
export const CONTACT_INBOX = 'info@alazharpark.com';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Header values must never carry a line break (header injection). */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ');

@Injectable()
export class ContactMessageService {
  private readonly logger = new Logger(ContactMessageService.name);

  constructor(private readonly email: EmailProvider) {}

  async send(dto: ContactMessageDto): Promise<void> {
    // A filled honeypot is a bot: report success, send nothing.
    if (dto.website) return;
    const name = oneLine(dto.name);
    await this.email.send({
      to: CONTACT_INBOX,
      subject: `Website message from ${name}`,
      text: `From: ${name} <${dto.email}>\n\n${dto.message}`,
      html: `<p><strong>From:</strong> ${escapeHtml(name)} &lt;${escapeHtml(dto.email)}&gt;</p><p style="white-space:pre-wrap">${escapeHtml(dto.message)}</p>`,
    });
    this.logger.log('Contact form message delivered');
  }
}
