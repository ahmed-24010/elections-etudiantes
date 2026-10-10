import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

/** Durée de vie d'une URL d'accès à une attestation (D-23). */
export const SIGNED_URL_TTL_MS = 5 * 60 * 1000;

/**
 * URL signée par le backend : HMAC-SHA256 lié au fichier, à l'utilisateur et à l'expiration. Le bucket S3 reste privé et
 * interne ; le navigateur ne parle qu'à l'API. Le jeton n'ouvre rien d'autre que ce fichier, pour cet utilisateur.
 */
@Injectable()
export class SignedUrlService {
  constructor(private readonly config: ConfigService) {}

  private mac(fileId: string, userId: string, exp: number): Buffer {
    return createHmac('sha256', this.config.getOrThrow<string>('FILE_SIGNING_SECRET')).update(`${fileId}.${userId}.${exp}`).digest();
  }

  sign(fileId: string, userId: string, now = Date.now()): { exp: number; sig: string } {
    const exp = now + SIGNED_URL_TTL_MS;
    return { exp, sig: this.mac(fileId, userId, exp).toString('hex') };
  }

  verify(fileId: string, userId: string, exp: number, sig: string, now = Date.now()): boolean {
    if (!Number.isInteger(exp) || exp <= now || exp - now > SIGNED_URL_TTL_MS) return false;
    if (!/^[0-9a-f]{64}$/.test(sig)) return false;
    return timingSafeEqual(this.mac(fileId, userId, exp), Buffer.from(sig, 'hex'));
  }
}
