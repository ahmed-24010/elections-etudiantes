import { MAX_EXTENSION_MS, extensionRefusal } from './voting-extension';

const H = 3_600_000;
const t0 = Date.parse('2026-10-20T08:00:00Z');
const at = (h: number) => new Date(t0 + h * H);
// Vote de 8 h à 20 h ; il est 14 h ; panne de 10 h à 12 h (2 h).
const election = { votingStartsAt: at(0), votingEndsAt: at(12) };
const now = at(6);
const outage = { outageStartedAt: at(2), outageEndedAt: at(4) };

describe('extensionRefusal (D-33, D-38)', () => {
  it('accepte une prolongation égale à la panne', () => {
    expect(extensionRefusal(election, now, { ...outage, newEndsAt: at(14) })).toBeNull();
  });
  it('accepte une prolongation plus courte que la panne', () => {
    expect(extensionRefusal(election, now, { ...outage, newEndsAt: at(13) })).toBeNull();
  });
  it('refuse une prolongation plus longue que la panne', () => {
    expect(extensionRefusal(election, now, { ...outage, newEndsAt: new Date(at(14).getTime() + 1) })).toBe('extension_exceeds_outage');
  });
  it('refuse un raccourcissement ou une fin inchangée', () => {
    expect(extensionRefusal(election, now, { ...outage, newEndsAt: at(12) })).toBe('extension_not_after_current');
    expect(extensionRefusal(election, now, { ...outage, newEndsAt: at(11) })).toBe('extension_not_after_current');
  });
  it('plafonne à 24 h même si la panne a duré plus longtemps', () => {
    const long = { votingStartsAt: at(0), votingEndsAt: at(100) };
    const late = new Date(t0 + 60 * H);
    const big = { outageStartedAt: at(2), outageEndedAt: at(40) }; // 38 h de panne
    expect(extensionRefusal(long, late, { ...big, newEndsAt: new Date(long.votingEndsAt.getTime() + MAX_EXTENSION_MS) })).toBeNull();
    expect(extensionRefusal(long, late, { ...big, newEndsAt: new Date(long.votingEndsAt.getTime() + MAX_EXTENSION_MS + 1) })).toBe('extension_exceeds_24h');
  });
  it('refuse une panne incohérente', () => {
    const base = { newEndsAt: at(13) };
    expect(extensionRefusal(election, now, { ...base, outageStartedAt: at(4), outageEndedAt: at(2) })).toBe('outage_invalid'); // fin avant début
    expect(extensionRefusal(election, now, { ...base, outageStartedAt: at(2), outageEndedAt: at(2) })).toBe('outage_invalid'); // durée nulle
    expect(extensionRefusal(election, now, { ...base, outageStartedAt: at(-3), outageEndedAt: at(-1) })).toBe('outage_invalid'); // avant le vote
    expect(extensionRefusal(election, now, { ...base, outageStartedAt: at(5), outageEndedAt: at(7) })).toBe('outage_invalid'); // pas terminée
    expect(extensionRefusal(election, now, { ...base, outageStartedAt: new Date('x'), outageEndedAt: at(4) })).toBe('outage_invalid');
  });
});
