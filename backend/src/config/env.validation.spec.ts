import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const ok = {
    DATABASE_URL: 'mysql://u:p@localhost:3306/db',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
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
});
