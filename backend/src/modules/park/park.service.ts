import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException, ErrorCode } from '../../common/errors/app-exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService, RequestContext } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { UpdateContactDto, UpdateParkDto } from './park.dto';

export interface Stat {
  value: string;
  labelEn: string;
  labelAr: string;
}

export interface ParkView {
  nameEn: string;
  nameAr: string;
  taglineEn: string | null;
  taglineAr: string | null;
  descriptionEn: string | null;
  descriptionAr: string | null;
  stats: Stat[];
  updatedAt: Date;
}

export interface ContactView {
  addressEn: string;
  addressAr: string;
  phones: string[];
  fax: string | null;
  email: string | null;
  mapsUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  socialLinks: Record<string, string>;
  updatedAt: Date;
}

const SOCIAL_KEYS = ['facebook', 'instagram', 'x', 'youtube', 'tiktok', 'linkedin'] as const;

/** Park information and contact details: both are single-row tables (id = 1), edited from the portal. */
@Injectable()
export class ParkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getPark(): Promise<ParkView> {
    const row = await this.prisma.parkSettings.findUnique({ where: { id: 1 } });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Park information has not been set up yet.', 404);
    return {
      nameEn: row.nameEn, nameAr: row.nameAr, taglineEn: row.taglineEn, taglineAr: row.taglineAr,
      descriptionEn: row.descriptionEn, descriptionAr: row.descriptionAr,
      stats: Array.isArray(row.stats) ? (row.stats as unknown as Stat[]) : [],
      updatedAt: row.updatedAt,
    };
  }

  async updatePark(dto: UpdateParkDto, actor: AuthenticatedUser, ctx: RequestContext): Promise<ParkView> {
    const before = await this.getPark();
    const data = {
      nameEn: dto.nameEn, nameAr: dto.nameAr, taglineEn: dto.taglineEn, taglineAr: dto.taglineAr,
      descriptionEn: dto.descriptionEn, descriptionAr: dto.descriptionAr,
      stats: dto.stats as unknown as Prisma.InputJsonValue, updatedById: actor.id,
    };
    await this.prisma.parkSettings.update({ where: { id: 1 }, data });
    const after = await this.getPark();
    await this.audit.record(
      { userId: actor.id, action: 'park.updated', entity: 'park_settings', entityId: '1', oldValue: strip(before), newValue: strip(after) },
      ctx,
    );
    return after;
  }

  async getContact(): Promise<ContactView> {
    const row = await this.prisma.contactInformation.findUnique({ where: { id: 1 } });
    if (!row) throw new AppException(ErrorCode.NOT_FOUND, 'Contact information has not been set up yet.', 404);
    const social: Record<string, string> = {};
    const raw = (row.socialLinks ?? {}) as Record<string, unknown>;
    for (const key of SOCIAL_KEYS) if (typeof raw[key] === 'string' && raw[key]) social[key] = raw[key] as string;
    return {
      addressEn: row.addressEn, addressAr: row.addressAr, phones: row.phones, fax: row.fax, email: row.email, mapsUrl: row.mapsUrl,
      latitude: row.latitude === null ? null : Number(row.latitude), longitude: row.longitude === null ? null : Number(row.longitude),
      socialLinks: social, updatedAt: row.updatedAt,
    };
  }

  async updateContact(dto: UpdateContactDto, actor: AuthenticatedUser, ctx: RequestContext): Promise<ContactView> {
    const before = await this.getContact();
    const social: Record<string, string> = {};
    for (const key of SOCIAL_KEYS) if (dto.socialLinks[key]) social[key] = dto.socialLinks[key] as string;
    await this.prisma.contactInformation.update({
      where: { id: 1 },
      data: {
        addressEn: dto.addressEn, addressAr: dto.addressAr, phones: dto.phones, fax: dto.fax, email: dto.email, mapsUrl: dto.mapsUrl,
        latitude: dto.latitude ?? null, longitude: dto.longitude ?? null, socialLinks: social, updatedById: actor.id,
      },
    });
    const after = await this.getContact();
    await this.audit.record(
      { userId: actor.id, action: 'contact.updated', entity: 'contact_information', entityId: '1', oldValue: strip(before), newValue: strip(after) },
      ctx,
    );
    return after;
  }
}

/** Audit values: the content itself, without the volatile timestamp. */
function strip<T extends { updatedAt: Date }>(view: T): Prisma.InputJsonValue {
  const { updatedAt: _ignored, ...rest } = view;
  return rest as unknown as Prisma.InputJsonValue;
}
