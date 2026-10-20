import { readFileSync } from 'fs';
import { join } from 'path';
import { PvData, PvLang, PvPerson, PvPosition } from './pv-data';
import { PV_LABELS, PvLabels } from './pv-labels';

const ASSETS = join(__dirname, '..', '..', 'assets');
const cache = new Map<string, string>();
const dataUri = (file: string, mime: string): string => {
  let uri = cache.get(file);
  if (!uri) {
    uri = `data:${mime};base64,${readFileSync(join(ASSETS, file)).toString('base64')}`;
    cache.set(file, uri);
  }
  return uri;
};

/** Pour une valeur insérée dans du HTML : jamais de balise venue d'une donnée (noms, motifs saisis par le comité). */
export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Date et heure en UTC (« 20/10/2026 14:05 »), chiffres occidentaux : identiques dans les deux langues. */
export function formatPvDate(d: Date, labels: PvLabels, withZone = true): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}${withZone ? ` ${labels.utc}` : ''}`;
}

/** Un nombre ou une date dans un texte arabe : toujours lu de gauche à droite, sans retourner ses chiffres. */
const ltr = (s: string | number): string => `<bdi dir="ltr">${esc(String(s))}</bdi>`;

/** Petites icônes au trait (SVG intégré, aucune ressource externe). */
const ICONS = {
  shield: '<path d="M12 3l7 3v5.5c0 4.6-3.2 7.7-7 9.5-3.8-1.8-7-4.9-7-9.5V6z"/><path d="M9 12l2 2 4-4"/>',
  fingerprint: '<path d="M5 9.5A8 8 0 0119 9.5"/><path d="M7.5 13c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5c0 2.2 0 4-1 6"/><path d="M12 12.5c0 3 0 5-1.2 7.5"/><path d="M9.2 14.5c0 2-.4 3.5-1.2 5"/>',
  document: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M9.5 12.5h5M9.5 16h5"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>',
  group: '<circle cx="9" cy="9" r="3"/><circle cx="17" cy="10" r="2.4"/><path d="M3.5 19c.5-3 3-5 5.5-5s5 2 5.5 5M15.5 15c3 0 4.6 1.5 5 4"/>',
} as const;
const icon = (name: keyof typeof ICONS): string =>
  `<svg class="ic" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const CSS = (fontsCss: string) => `
${fontsCss}
@page { size: A4; margin: 9mm 12mm 13mm; @bottom-center { content: var(--footer) "\\2066" counter(page) " / " counter(pages) "\\2069"; font: 7.5pt 'PV Sans', 'PV Naskh', sans-serif; color: #667085; } }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: #fff; color: #1a2233; font: 9pt/1.45 'PV Sans', 'PV Naskh', sans-serif; }
:root { --accent: #0b4f6c; --accent-soft: #e8f1f5; --line: #cfd6df; --muted: #5b6678; --warn: #8a4b00; --warn-soft: #fff4e0; --code: #f1f3f6; }
.ic { flex: none; color: var(--accent); }
.top { display: flex; align-items: center; gap: 12px; padding-bottom: 7px; border-bottom: 2px solid var(--accent); }
.top img { height: 42px; width: auto; }
.top .titles { flex: 1; }
.kicker { font-size: 7.5pt; letter-spacing: .06em; color: var(--muted); text-transform: uppercase; }
h1 { margin: 0; font-size: 16pt; line-height: 1.25; color: var(--accent); }
.election { margin: 7px 0 0; font-size: 11pt; font-weight: 700; }
.institution { margin: 0; color: var(--muted); font-size: 8.5pt; }
.sec { margin-top: 8px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; align-items: start; }
.grid2 > .pos { margin-top: 0; }
.sec-head { display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--line); padding-bottom: 3px; margin-bottom: 6px; }
.sec-head .no { min-width: 28px; padding: 0 5px; text-align: center; border: 1.5px solid var(--accent); border-radius: 5px; color: var(--accent); font-weight: 700; font-size: 9pt; }
.sec-head h2 { margin: 0; font-size: 11pt; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.stat { border: 1.5px solid var(--line); border-radius: 7px; padding: 4px 6px 3px; text-align: center; }
.stat.main { border-color: var(--accent); background: var(--accent-soft); }
.stat .n { display: block; font-size: 19pt; font-weight: 700; line-height: 1.15; color: var(--accent); }
.stat .l { display: block; font-size: 7.5pt; color: var(--muted); }
.note { margin: 4px 0 0; font-size: 7.5pt; color: var(--muted); }
.note.warn { color: var(--warn); }
.cells { display: grid; gap: 6px; }
.cells.c3 { grid-template-columns: repeat(3, 1fr); }
.cells.ids { grid-template-columns: 1.7fr 1fr 1.1fr; }
.cells.c4 { grid-template-columns: 1.1fr 1.5fr 1.1fr 1.6fr; }
.cell { border: 1px solid var(--line); border-radius: 6px; padding: 3px 8px 4px; min-width: 0; }
.cell .k { display: flex; align-items: center; gap: 5px; font-size: 7.5pt; color: var(--muted); }
.cell .v { display: block; margin-top: 1px; font-weight: 600; font-size: 8.5pt; overflow-wrap: anywhere; }
.cell.warn { border-color: var(--warn); background: var(--warn-soft); }
.mono { display: inline-block; direction: ltr; unicode-bidi: isolate; font-family: 'PV Mono', monospace; font-weight: 700; font-size: 8pt; background: var(--code); border: 1px solid #e0e4ea; border-radius: 4px; padding: 1px 5px; letter-spacing: .01em; }
.mono.digest { display: block; margin-top: 3px; font-size: 7.6pt; white-space: nowrap; text-align: start; }
.pos { margin-top: 6px; border: 1px solid var(--line); border-radius: 7px; padding: 5px 10px 6px; break-inside: avoid; }
.pos-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.pos-head h3 { margin: 0; font-size: 10pt; }
.chip { font-size: 7.5pt; color: var(--muted); border: 1px solid var(--line); border-radius: 99px; padding: 0 7px; }
.badge-tie { margin-inline-start: auto; font-size: 7.5pt; font-weight: 700; color: var(--warn); background: var(--warn-soft); border: 1.5px solid var(--warn); border-radius: 99px; padding: 0 9px; }
.cand { display: grid; grid-template-columns: 37% 1fr 29%; align-items: center; gap: 8px; margin-top: 3px; }
.cand .who { font-weight: 600; }
.cand .bar { height: 7px; border-radius: 4px; background: #e6eaf0; overflow: hidden; }
.cand .bar i { display: block; height: 100%; background: #9aa8bd; }
.cand.win .bar i { background: var(--accent); }
.cand .v { text-align: end; font-variant-numeric: tabular-nums; font-size: 8.5pt; }
.cand .v b { font-size: 9.5pt; }
.tag { display: inline-block; margin-inline-start: 5px; font-size: 7pt; font-weight: 700; color: #fff; background: var(--accent); border-radius: 99px; padding: 0 6px; vertical-align: 1px; }
.tag.tie { background: var(--warn); }
.cand.blank { color: var(--muted); }
.tienote { margin: 5px 0 0; padding: 3px 8px; font-size: 7.8pt; color: var(--warn); background: var(--warn-soft); border-radius: 5px; }
.withheld { margin: 3px 0 1px; color: var(--muted); font-size: 8.5pt; }
.committee { margin-top: 6px; border: 1px solid var(--line); border-radius: 8px; padding: 5px 8px 7px; }
.committee h3 { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 9.5pt; }
.committee .help { margin: 1px 0 5px; font-size: 7.5pt; color: var(--muted); }
.sigs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.sig { border: 1px solid var(--line); border-radius: 6px; padding: 3px 6px 5px; break-inside: avoid; }
.sig .who { font-size: 7.5pt; font-weight: 700; color: var(--accent); }
.sig .lab { display: block; margin-top: 3px; font-size: 7pt; color: var(--muted); }
.sig .field { height: 14px; border: 1px solid #aab4c2; border-radius: 3px; background: #fff; }
.sig .field.tall { height: 26px; }
.sig.obs { grid-column: 1 / -1; }
.sig.obs .field { height: 22px; }
`;

const FONTS = (): string => `
@font-face { font-family: 'PV Sans'; font-weight: 400; src: url(${dataUri('fonts/NotoSans_400Regular.ttf', 'font/ttf')}); }
@font-face { font-family: 'PV Sans'; font-weight: 700; src: url(${dataUri('fonts/NotoSans_700Bold.ttf', 'font/ttf')}); }
@font-face { font-family: 'PV Naskh'; font-weight: 400; src: url(${dataUri('fonts/NotoNaskhArabic_400Regular.ttf', 'font/ttf')}); }
@font-face { font-family: 'PV Naskh'; font-weight: 700; src: url(${dataUri('fonts/NotoNaskhArabic_700Bold.ttf', 'font/ttf')}); }
@font-face { font-family: 'PV Mono'; font-weight: 400; src: url(${dataUri('fonts/NotoSansMono_400Regular.ttf', 'font/ttf')}); }
@font-face { font-family: 'PV Mono'; font-weight: 700; src: url(${dataUri('fonts/NotoSansMono_700Bold.ttf', 'font/ttf')}); }`;

function renderPosition(p: PvPosition, l: PvLabels, lang: PvLang): string {
  const person = (x: PvPerson) => `<bdi>${esc(lang === 'ar' && x.nameAr ? x.nameAr : x.name)}</bdi>`;
  const title = esc(lang === 'ar' && p.titleAr ? p.titleAr : p.title);
  const head = `<div class="pos-head"><h3>${title}</h3><span class="chip">${esc(l.seats(p.seats))}</span>${p.tie ? `<span class="badge-tie">${esc(l.tieBadge)}</span>` : ''}</div>`;
  if (!p.detailPublished) {
    // D-32 : sous 3 votants, ni voix ni barres, seulement les élus.
    return `<div class="pos">${head}<p class="withheld">${esc(l.withheld)} <b>${esc(l.winnersOnly)} :</b> ${p.winners.length ? p.winners.map(person).join(l.sep) : l.none}</p></div>`;
  }
  const tied = new Set((p.tie?.tied ?? []).map((t) => t.name));
  const total = p.candidates.reduce((s, c) => s + c.votes, 0) + (p.blank ?? 0);
  const pct = (v: number) => (total === 0 ? 0 : Math.round((v / total) * 1000) / 10);
  const rows = p.candidates
    .map((c) => {
      const tag = c.isWinner ? `<span class="tag">${esc(l.elected)}</span>` : tied.has(c.person.name) ? `<span class="tag tie">${esc(l.tieBadge.split(' — ')[0])}</span>` : '';
      return `<div class="cand${c.isWinner ? ' win' : ''}"><div class="who">${person(c.person)}${tag}</div><div class="bar"><i style="width:${pct(c.votes)}%"></i></div><div class="v"><b>${ltr(c.votes)}</b> ${esc(l.votes)} · ${ltr(`${pct(c.votes)} %`)}</div></div>`;
    })
    .join('');
  const blank = `<div class="cand blank"><div class="who">${esc(l.blank)}</div><div class="bar"><i style="width:${pct(p.blank ?? 0)}%"></i></div><div class="v">${ltr(p.blank ?? 0)}</div></div>`;
  const tie = p.tie ? `<p class="tienote">${esc(l.tieText(p.tie.seatsLeft))} (${p.tie.tied.map(person).join(l.sep)})</p>` : '';
  return `<div class="pos">${head}${rows}${blank}${tie}</div>`;
}

/** Procès-verbal dans UNE langue (D-42) : HTML autonome (polices, icônes et logo intégrés), prêt à être imprimé en PDF par Chromium. */
export function renderPvHtml(data: PvData, lang: PvLang): string {
  const l = PV_LABELS[lang];
  const d = data;
  const local = (name: string, nameAr: string | null) => esc(lang === 'ar' && nameAr ? nameAr : name);
  const stat = (n: string | number, label: string, main = false) => `<div class="stat${main ? ' main' : ''}"><span class="n">${ltr(n)}</span><span class="l">${esc(label)}</span></div>`;
  const sec = (no: string, title: string, body: string) => `<section class="sec"><div class="sec-head"><span class="no">${no}</span><h2>${esc(title)}</h2></div>${body}</section>`;
  const cell = (k: string, v: string, ic?: keyof typeof ICONS, cls = '') => `<div class="cell ${cls}"><span class="k">${ic ? icon(ic) : ''}${esc(k)}</span><span class="v">${v}</span></div>`;
  const date = (x: Date, zone = true) => ltr(formatPvDate(x, l, zone));

  const calendar =
    `<div class="cells c3">${cell(l.votingStart, date(d.votingStartsAt), 'calendar')}${cell(l.votingEnd, date(d.votingEndsAt), 'calendar')}${d.publishedAt ? cell(l.publishedAt, date(d.publishedAt), 'calendar') : ''}</div>` +
    (d.extension
      ? `<div class="cells c4" style="margin-top:6px">${cell(l.originalEnd, date(d.extension.originalEndsAt), undefined, 'warn')}${cell(l.outage, `${l.outageRange(date(d.extension.outageStartedAt, false), date(d.extension.outageEndedAt, false))} ${esc(l.utc)}`, undefined, 'warn')}${cell(l.newEnd, date(d.extension.newEndsAt), undefined, 'warn')}${cell(`${l.incidentTitle} — ${l.reason}`, esc(d.extension.reason), undefined, 'warn')}</div>`
      : `<p class="note" style="margin-top:5px">${esc(l.noIncident)}</p>`);

  const members = Array.from({ length: Math.max(3, d.committeeSize) }, (_, i) => `<div class="sig"><div class="who">${esc(l.member(i + 1))}</div><span class="lab">${esc(l.name)}</span><div class="field"></div><span class="lab">${esc(l.signature)}</span><div class="field tall"></div></div>`).join('');
  const observations = `<div class="sig obs"><div class="who">${esc(l.observations)}</div><div class="field"></div></div>`;

  const integrity =
    `<div class="cell"><span class="k">${icon('fingerprint')}${esc(l.digestTitle)}</span><span class="mono digest">${esc(d.ballotsDigest)}</span><p class="note" style="margin:2px 0 0">${esc(l.digestHelp)}</p></div>` +
    `<div class="cells ids" style="margin-top:5px">${cell(l.reportId, `<span class="mono">${esc(d.reportId)}</span>`, 'document')}${cell(l.verificationCode, `<span class="mono">${esc(d.verificationCode)}</span>`, 'shield')}${cell(l.generatedAt, `<span class="mono">${esc(formatPvDate(d.generatedAt, l, false))} UTC</span>`, 'calendar')}</div>` +
    `<div class="committee"><h3>${icon('group')}${esc(l.signaturesTitle)}</h3><p class="help">${esc(l.signaturesHelp)}</p><div class="sigs">${members}${observations}</div></div>`;

  return `<!doctype html><html lang="${lang}" dir="${l.dir}"><head><meta charset="utf-8"><title>${esc(l.title)}</title><style>${CSS(FONTS())}
:root { --footer: "${esc(d.verificationCode)} · ${esc(l.page)} "; }</style></head><body>
<header class="top"><img src="${dataUri('branding/logo-fsjp.jpg', 'image/jpeg')}" alt=""><div class="titles"><div class="kicker">${esc(l.documentSubtitle)}</div><h1>${esc(l.title)}</h1></div></header>
<p class="election">${local(d.election.title, d.election.titleAr)}${d.election.round > 1 ? ` — ${esc(l.round(d.election.round))}` : ''}</p>
<p class="institution">${esc(l.institution)} : ${local(d.institution.name, d.institution.nameAr)}</p>
${sec('01', l.s1, `<div class="stats">${stat(d.registered, l.registered)}${stat(d.voters, l.voters)}${stat(d.ballots, l.ballots)}${stat(`${d.turnoutRate} %`, l.turnout, true)}</div>${d.addedAfterFreeze > 0 ? `<p class="note warn">${esc(l.ofWhichAdded(d.addedAfterFreeze))}</p>` : ''}<p class="note">${esc(l.integrityOk)}</p>`)}
${sec('02', l.s2, calendar)}
<section class="sec"><div class="sec-head"><span class="no">03</span><h2>${esc(l.s3)}</h2></div><div class="grid2">${d.positions.map((p) => renderPosition(p, l, lang)).join('')}</div></section>
${sec('04', l.s4, integrity)}
</body></html>`;
}
