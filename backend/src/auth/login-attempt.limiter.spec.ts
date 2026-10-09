import { LoginAttemptLimiter } from './login-attempt.limiter';

describe('LoginAttemptLimiter', () => {
  it('verrouille un compte après 5 échecs, indépendamment des autres comptes', () => {
    const l = new LoginAttemptLimiter();
    for (let i = 0; i < 4; i++) l.fail('u1');
    expect(l.isLocked('u1')).toBe(false);
    l.fail('u1');
    expect(l.isLocked('u1')).toBe(true);
    expect(l.isLocked('u2')).toBe(false);
  });

  it('se déverrouille après la fenêtre, et reset efface le compteur', () => {
    const l = new LoginAttemptLimiter();
    const t0 = 1_000_000;
    for (let i = 0; i < 5; i++) l.fail('u1', t0);
    expect(l.isLocked('u1', t0 + 14 * 60_000)).toBe(true);
    expect(l.isLocked('u1', t0 + 16 * 60_000)).toBe(false);
    for (let i = 0; i < 5; i++) l.fail('u2', t0);
    l.reset('u2');
    expect(l.isLocked('u2', t0)).toBe(false);
  });
});
