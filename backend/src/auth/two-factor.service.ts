import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// otplib 12 (CommonJS). La v13 dépend de modules ESM uniquement, que Jest/CommonJS ne charge pas.
import { authenticator } from 'otplib';
import { SecretCipher } from '../common/crypto/secret-cipher';

/** TOTP (RFC 6238). Le secret n'est jamais stocké en clair (02 §10). */
@Injectable()
export class TwoFactorService {
  private readonly cipher: SecretCipher;

  constructor(private readonly config: ConfigService) {
    authenticator.options = { window: 1 }; // ±1 période de 30 s
    this.cipher = new SecretCipher(config.getOrThrow<string>('TWO_FACTOR_ENCRYPTION_KEY'));
  }

  newSecret(label: string): { secret: string; encrypted: string; otpauthUri: string } {
    const secret = authenticator.generateSecret();
    return {
      secret,
      encrypted: this.cipher.encrypt(secret),
      otpauthUri: authenticator.keyuri(label, this.config.get('TWO_FACTOR_ISSUER', 'Elections Etudiantes'), secret),
    };
  }

  /** Tolérance d'une période de 30 s de chaque côté (dérive d'horloge, authenticator.options.window). Jamais d'exception : faux en cas de doute. */
  verify(encryptedSecret: string | null | undefined, code: string): boolean {
    if (!encryptedSecret) return false;
    try {
      return authenticator.verify({ secret: this.cipher.decrypt(encryptedSecret), token: code });
    } catch {
      return false;
    }
  }
}
