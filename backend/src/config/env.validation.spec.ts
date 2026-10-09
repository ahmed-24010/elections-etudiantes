import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const ok = {
    DATABASE_URL: 'mysql://u:p@localhost:3306/db',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    TWO_FACTOR_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    AUDIT_IP_SALT: 's'.repeat(16),
  };
  it('accepte une config valide et applique les défauts', () => {
    expect(validateEnv(ok).PORT).toBe(3000);
  });
  it('rejette des secrets JWT trop courts', () => {
    expect(() => validateEnv({ ...ok, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
  });
  it('rejette une config sans DATABASE_URL', () => {
    expect(() => validateEnv({ ...ok, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });
  it('rejette une clé de chiffrement 2FA qui ne fait pas 32 octets', () => {
    expect(() => validateEnv({ ...ok, TWO_FACTOR_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).toThrow(/TWO_FACTOR_ENCRYPTION_KEY/);
    expect(() => validateEnv({ ...ok, TWO_FACTOR_ENCRYPTION_KEY: undefined })).toThrow(/TWO_FACTOR_ENCRYPTION_KEY/);
  });
  it("rejette un sel d'audit trop court", () => {
    expect(() => validateEnv({ ...ok, AUDIT_IP_SALT: 'court' })).toThrow(/AUDIT_IP_SALT/);
  });
});
