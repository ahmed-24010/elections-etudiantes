import { randomBytes } from 'crypto';
import { SecretCipher } from './secret-cipher';

const key = () => randomBytes(32).toString('base64');

describe('SecretCipher (AES-256-GCM)', () => {
  it('chiffre puis déchiffre, et ne laisse pas le clair dans le résultat', () => {
    const c = new SecretCipher(key());
    const enc = c.encrypt('JBSWY3DPEHPK3PXP');
    expect(enc).toMatch(/^v1\.[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(enc).not.toContain('JBSWY3DPEHPK3PXP');
    expect(c.decrypt(enc)).toBe('JBSWY3DPEHPK3PXP');
    expect(enc.length).toBeLessThanOrEqual(512); // taille de la colonne users.twoFactorSecretEnc
  });

  it('utilise un IV aléatoire : deux chiffrements du même texte diffèrent', () => {
    const c = new SecretCipher(key());
    expect(c.encrypt('secret')).not.toBe(c.encrypt('secret'));
  });

  it('détecte toute altération (tag GCM)', () => {
    const c = new SecretCipher(key());
    const [v, iv, tag, data] = c.encrypt('secret').split('.');
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 1;
    expect(() => c.decrypt([v, iv, tag, flipped.toString('base64url')].join('.'))).toThrow();
    expect(() => c.decrypt([v, iv, Buffer.alloc(16).toString('base64url'), data].join('.'))).toThrow();
  });

  it('refuse une mauvaise clé et un format inconnu', () => {
    const enc = new SecretCipher(key()).encrypt('secret');
    expect(() => new SecretCipher(key()).decrypt(enc)).toThrow();
    expect(() => new SecretCipher(key()).decrypt('v2.a.b.c')).toThrow();
    expect(() => new SecretCipher(key()).decrypt('n-importe-quoi')).toThrow();
  });

  it('refuse une clé qui ne fait pas 32 octets', () => {
    expect(() => new SecretCipher(randomBytes(16).toString('base64'))).toThrow();
  });
});
