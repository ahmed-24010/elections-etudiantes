import { authenticator } from 'otplib';
import { TwoFactorService } from './two-factor.service';

const config = (key = Buffer.alloc(32, 9).toString('base64')) =>
  ({ getOrThrow: () => key, get: (_k: string, d: string) => d }) as any;

describe('TwoFactorService (TOTP)', () => {
  it('génère un secret chiffré et une URI otpauth avec l’émetteur', () => {
    const s = new TwoFactorService(config()).newSecret('alice@example.test');
    expect(s.encrypted).not.toContain(s.secret);
    expect(s.otpauthUri).toContain('otpauth://totp/');
    expect(decodeURIComponent(s.otpauthUri)).toContain('Elections Etudiantes');
    expect(s.otpauthUri).toContain(`secret=${s.secret}`);
  });

  it('accepte le code courant et refuse un mauvais code', () => {
    const svc = new TwoFactorService(config());
    const s = svc.newSecret('a@example.test');
    expect(svc.verify(s.encrypted, authenticator.generate(s.secret))).toBe(true);
    expect(svc.verify(s.encrypted, '000000')).toBe(false);
  });

  it('refuse un code d’une autre période (hors fenêtre de ±30 s)', () => {
    const svc = new TwoFactorService(config());
    const s = svc.newSecret('a@example.test');
    const old = authenticator.generate(s.secret);
    jest.useFakeTimers().setSystemTime(Date.now() + 5 * 60_000);
    try {
      expect(svc.verify(s.encrypted, old)).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('retourne faux (sans exception) si le secret est absent, altéré ou chiffré avec une autre clé', () => {
    const svc = new TwoFactorService(config());
    const s = svc.newSecret('a@example.test');
    const code = authenticator.generate(s.secret);
    expect(svc.verify(null, code)).toBe(false);
    expect(svc.verify('v1.zz.zz.zz', code)).toBe(false);
    expect(new TwoFactorService(config(Buffer.alloc(32, 1).toString('base64'))).verify(s.encrypted, code)).toBe(false);
  });
});
