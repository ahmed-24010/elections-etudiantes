import { PvData, PvPosition } from './pv-data';
import { renderPvHtml as renderFull } from './pv-html';
import { PV_LABELS } from './pv-labels';

/** Le document sans sa feuille de style (polices intégrées en base64) : des messages d'échec lisibles. */
const renderPvHtml = (...args: Parameters<typeof renderFull>) => renderFull(...args).replace(/<style>[\s\S]*?<\/style>/, '').replace(/data:[^"]+"/g, '"');
const d = (s: string) => new Date(s);
const person = (name: string, nameAr: string | null = null) => ({ name, nameAr });
const position = (over: Partial<PvPosition> = {}): PvPosition => ({
  title: 'Président', titleAr: 'الرئيس', seats: 1, detailPublished: true, blank: 2, winners: [person('Omar Diallo', 'عمر جالو')], tie: null,
  candidates: [{ person: person('Omar Diallo', 'عمر جالو'), votes: 12, rank: 1, isWinner: true }, { person: person('Aïcha Ba'), votes: 8, rank: 2, isWinner: false }], ...over,
});
const data = (over: Partial<PvData> = {}): PvData => ({
  institution: { name: 'FSJP', nameAr: 'كلية العلوم القانونية' },
  election: { title: 'Bureau du groupe A', titleAr: 'مكتب المجموعة أ', round: 1 },
  votingStartsAt: d('2026-11-02T08:00:00Z'), votingEndsAt: d('2026-11-04T18:00:00Z'), publishedAt: d('2026-11-04T19:00:00Z'),
  registered: 31, addedAfterFreeze: 0, voters: 22, ballots: 22, turnoutRate: 71, extension: null, positions: [position()],
  ballotsDigest: 'a'.repeat(64), reportId: '7d9e2c14-5a3b-4f8e-9c21-0b6a8d4e1f73', verificationCode: 'PV-7D9E2C145A3B', generatedAt: d('2026-11-04T19:01:00Z'), committeeSize: 3, ...over,
});

describe('Procès-verbal : gabarit (D-42, D-43)', () => {
  it('une langue par document : lang et dir, textes de cette langue seulement', () => {
    const fr = renderPvHtml(data(), 'fr');
    const ar = renderPvHtml(data(), 'ar');
    expect(fr).toContain('<html lang="fr" dir="ltr">');
    expect(ar).toContain('<html lang="ar" dir="rtl">');
    expect(fr).toContain(PV_LABELS.fr.title);
    expect(fr).not.toContain(PV_LABELS.ar.title);
    expect(ar).toContain(PV_LABELS.ar.title);
    expect(ar).not.toContain(PV_LABELS.fr.title);
  });

  it('mêmes identifiant, code de vérification, empreinte et chiffres dans les deux langues', () => {
    for (const lang of ['fr', 'ar'] as const) {
      const html = renderPvHtml(data(), lang);
      for (const v of ['7d9e2c14-5a3b-4f8e-9c21-0b6a8d4e1f73', 'PV-7D9E2C145A3B', 'a'.repeat(64), '>31<', '>22<', '71 %']) expect(html).toContain(v);
    }
  });

  it('les noms de postes et de candidats viennent des données (de la base), dans la langue du document', () => {
    const fr = renderPvHtml(data({ positions: [position({ title: 'Délégué des sports', titleAr: 'مندوب الرياضة' })] }), 'fr');
    const ar = renderPvHtml(data({ positions: [position({ title: 'Délégué des sports', titleAr: 'مندوب الرياضة' })] }), 'ar');
    expect(fr).toContain('Délégué des sports');
    expect(fr).not.toContain('مندوب الرياضة');
    expect(ar).toContain('مندوب الرياضة');
    expect(ar).toContain('عمر جالو'); // nom arabe du candidat quand il existe
    expect(ar).toContain('Aïcha Ba'); // sinon son nom latin
  });

  it('les données saisies sont échappées (aucune balise ne peut être injectée dans le PV)', () => {
    const html = renderPvHtml(data({ election: { title: '<script>alert(1)</script>', titleAr: null, round: 1 }, positions: [position({ title: '<img src=x onerror=alert(1)>' })], extension: { originalEndsAt: d('2026-11-04T18:00:00Z'), newEndsAt: d('2026-11-04T20:00:00Z'), outage: null, reason: '<b>pirate</b>' } }), 'fr');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>pirate</b>');
    expect(html).toContain('&lt;script&gt;');
  });

  describe('singulier / pluriel', () => {
    it('1 ajout exceptionnel (pas « ajout(s) »), plusieurs au pluriel', () => {
      expect(renderPvHtml(data({ addedAfterFreeze: 1 }), 'fr')).toContain('dont 1 ajout exceptionnel après');
      expect(renderPvHtml(data({ addedAfterFreeze: 3 }), 'fr')).toContain('dont 3 ajouts exceptionnels après');
      expect(renderPvHtml(data({ addedAfterFreeze: 1 }), 'fr')).not.toContain('(s)');
      expect(PV_LABELS.ar.ofWhichAdded(1)).toContain('إضافة استثنائية واحدة');
      expect(PV_LABELS.ar.ofWhichAdded(2)).toContain('إضافتان استثنائيتان');
      expect(PV_LABELS.ar.ofWhichAdded(5)).toContain('5 إضافات استثنائية');
      expect(PV_LABELS.ar.ofWhichAdded(12)).toContain('12 إضافة استثنائية');
    });
    it('un seul élu : « الفائز » ; plusieurs : « الفائزون »', () => {
      expect(PV_LABELS.ar.winnersLabel(1)).toBe('الفائز');
      expect(PV_LABELS.ar.winnersLabel(2)).toBe('الفائزان');
      expect(PV_LABELS.ar.winnersLabel(3)).toBe('الفائزون');
      expect(PV_LABELS.fr.winnersLabel(1)).toBe('Élu(e)');
      expect(PV_LABELS.fr.winnersLabel(2)).toBe('Élus');
      const small = position({ detailPublished: false, candidates: [], blank: null });
      expect(renderPvHtml(data({ positions: [small] }), 'ar')).toContain('الفائز :');
      expect(renderPvHtml(data({ positions: [small] }), 'ar')).not.toContain('الفائزون :');
    });
    it('sièges : 1 siège / 2 sièges ; en arabe 1 مقعد واحد, 2 مقعدان, 3 مقاعد', () => {
      expect(PV_LABELS.fr.seats(1)).toBe('1 siège');
      expect(PV_LABELS.fr.seats(2)).toBe('2 sièges');
      expect([1, 2, 3, 11].map(PV_LABELS.ar.seats)).toEqual(['مقعد واحد', 'مقعدان', '3 مقاعد', '11 مقعد']);
    });
  });

  describe('D-32 : sous le seuil de votants, ni voix ni barres, seulement les élus', () => {
    const withheld = position({ detailPublished: false, candidates: [], blank: null, winners: [person('Ali Ndiaye')] });
    it('aucune voix imprimée', () => {
      const html = renderPvHtml(data({ voters: 2, positions: [withheld] }), 'fr');
      expect(html).toContain(PV_LABELS.fr.withheld);
      expect(html).toContain('Ali Ndiaye');
      expect(html).not.toContain('class="bar"');
      expect(html).not.toContain('<div class="v">'); // aucune ligne de voix
    });
    it('au-dessus du seuil, les barres de voix sont présentes', () => {
      expect(renderPvHtml(data(), 'fr')).toContain('class="bar"');
    });
  });

  it('égalité : badge « Égalité — second tour », ex-aequo nommés, siège à pourvoir', () => {
    const tie = position({ winners: [], tie: { tied: [person('Sara Fall'), person('Éric N’Diaye')], seatsLeft: 1 }, candidates: [{ person: person('Sara Fall'), votes: 11, rank: 1, isWinner: false }, { person: person('Éric N’Diaye'), votes: 11, rank: 1, isWinner: false }] });
    const html = renderPvHtml(data({ positions: [tie] }), 'fr');
    expect(html).toContain('Égalité — second tour');
    expect(html).toContain('Sara Fall');
    expect(html).toContain('1 siège à pourvoir');
    expect(renderPvHtml(data({ positions: [tie] }), 'ar')).toContain('تعادل — دور ثانٍ');
  });

  it('prolongation : fin initiale, panne, nouvelle fin et motif ; sans prolongation, la mention l’indique', () => {
    const ext = { originalEndsAt: d('2026-11-04T18:00:00Z'), newEndsAt: d('2026-11-04T20:00:00Z'), outage: { from: d('2026-11-03T09:10:00Z'), to: d('2026-11-03T10:40:00Z') }, reason: 'Panne du serveur' };
    const html = renderPvHtml(data({ extension: ext }), 'fr');
    for (const v of ['04/11/2026 18:00', '03/11/2026 09:10', '03/11/2026 10:40', '04/11/2026 20:00', 'Panne du serveur']) expect(html).toContain(v);
    expect(renderPvHtml(data(), 'fr')).toContain(PV_LABELS.fr.noIncident);
  });

  describe('signatures (D-42)', () => {
    it('une case par membre du comité, au moins 3, plus « Observations / ملاحظات », toutes vides', () => {
      const count = (html: string) => (html.match(/class="sig"/g) ?? []).length;
      expect(count(renderPvHtml(data({ committeeSize: 1 }), 'fr'))).toBe(3);
      expect(count(renderPvHtml(data({ committeeSize: 5 }), 'fr'))).toBe(5);
      expect(renderPvHtml(data(), 'fr')).toContain('Observations');
      expect(renderPvHtml(data(), 'ar')).toContain('ملاحظات');
      expect(renderPvHtml(data(), 'fr')).toMatch(/<div class="field"><\/div>/); // case vide : rien n'est pré-rempli
    });
    it('jamais d’adresse e-mail dans le document', () => {
      for (const lang of ['fr', 'ar'] as const) expect(renderPvHtml(data(), lang)).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    });
  });
});
