import { createHmac, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AppConfigService } from '../../config/app-config.service';

export const JWT_ISSUER = 'azharpark-api';
export const JWT_AUDIENCE = 'azharpark-portal';

export interface AccessClaims {
  /** user id */
  sub: string;
  /** user.tokenVersion at issue time: bumping it on the user kills every outstanding access token */
  tv: number;
  /** session (refresh-token family) id: ending the session ends the access token too */
  sid: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  get accessTtlSeconds(): number {
    return this.config.get('ACCESS_TOKEN_TTL_MINUTES') * 60;
  }

  signAccessToken(claims: AccessClaims): Promise<string> {
    return this.jwt.signAsync(claims, {
      secret: this.config.jwtAccessSecret,
      algorithm: 'HS256',
      expiresIn: this.accessTtlSeconds,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
  }

  /** Returns the claims, or null for anything wrong (bad signature, expired, wrong issuer/audience/shape). */
  async verifyAccessToken(token: string): Promise<AccessClaims | null> {
    try {
      const payload = await this.jwt.verifyAsync<Partial<AccessClaims>>(token, {
        secret: this.config.jwtAccessSecret,
        algorithms: ['HS256'],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string' || !Number.isInteger(payload.tv)) return null;
      return { sub: payload.sub, tv: payload.tv as number, sid: payload.sid };
    } catch {
      return null;
    }
  }

  /** An opaque 256-bit random secret (refresh tokens, password-reset tokens). */
  newOpaqueToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /**
   * What the database stores for an opaque token. HMAC with a server secret, so a copy of the database alone
   * is not enough to use or even test guesses against the tokens.
   */
  hashOpaqueToken(token: string): string {
    return createHmac('sha256', this.config.tokenHashSecret).update(token).digest('hex');
  }
}
