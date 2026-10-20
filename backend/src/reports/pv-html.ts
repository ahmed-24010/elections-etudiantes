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

const CSS = (fontsCss: string) => `
${fontsCss}
@page { size: A4; margin: 13mm 14mm 17mm; @bottom-center { content: var(--footer) "\\2066" counter(page) " / " counter(pages) "\\2069"; font: 8pt 'PV Sans', 'PV Naskh', sans-serif; color: #667085; } }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: #fff; color: #1a2233; font: 10pt/1.55 'PV Sans', 'PV Naskh', sans-serif; }
:root { --accent: #0b4f6c; --accent-soft: #e8f1f5; --line: #cfd6df; --muted: #5b6678; --warn: #8a4b00; --warn-soft: #fff4e0; }
.top { display: flex; align-items: center; gap: 14px; padding-bottom: 10px; border-bottom: 2.5px solid var(--accent); }
.top img { height: 62px; width: auto; }
.top .titles { flex: 1; }
.kicker { font-size: 8.5pt; letter-spacing: .06em; color: var(--muted); text-transform: uppercase; }
h1 { margin: 2px 0 0; font-size: 19pt; line-height: 1.25; color: var(--accent); }
.election { margin: 10px 0 0; font-size: 12.5pt; font-weight: 700; }
.institution { color: var(--muted); font-size: 9.5pt; }
.sec { margin-top: 18px; break-inside: avoid-page; }
.sec-head { display: flex; align-items: center; gap: 10px; border-bottom: 1px solid var(--line); padding-bottom: 5px; margin-bottom: 10px; }
.sec-head .no { min-width: 34px; padding: 1px 6px; text-align: center; border: 1.5px solid var(--accent); border-radius: 6px; color: var(--accent); font-weight: 700; font-size: 10.5pt; }
.sec-head h2 { margin: 0; font-size: 13pt; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.stat { border: 1.5px solid var(--line); border-radius: 8px; padding: 8px 6px 6px; text-align: center; }
.stat.main { border-color: var(--accent); background: var(--accent-soft); }
.stat .n { display: block; font-size: 26pt; font-weight: 700; line-height: 1.1; color: var(--accent); }
.stat .l { display: block; margin-top: 2px; font-size: 8.5pt; color: var(--muted); }
.note { margin: 7px 0 0; font-size: 9pt; color: var(--muted); }
.note.warn { color: var(--warn); }
dl.kv { display: grid; grid-template-columns: 38% 1fr; gap: 3px 10px; margin: 0; }
dl.kv dt { color: var(--muted); }
dl.kv dd { margin: 0; font-weight: 600; }
.box { margin-top: 10px; border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; }
.box h3 { margin: 0 0 5px; font-size: 10.5pt; }
.pos { margin-top: 10px; border: 1px solid var(--line); border-radius: 8px; padding: 9px 12px; break-inside: avoid; }
.pos-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.pos-head h3 { margin: 0; font-size: 11.5pt; }
.chip { font-size: 8.5pt; color: var(--muted); border: 1px solid var(--line); border-radius: 99px; padding: 0 8px; }
.badge-tie { margin-inline-start: auto; font-size: 8.5pt; font-weight: 700; color: var(--warn); background: var(--warn-soft); border: 1.5px solid var(--warn); border-radius: 99px; padding: 1px 10px; }
.cand { display: grid; grid-template-columns: 34% 1fr 17%; align-items: center; gap: 10px; margin-top: 7px; }
.cand .who { font-weight: 600; }
.cand .bar { height: 9px; border-radius: 5px; background: #e6eaf0; overflow: hidden; }
.cand .bar i { display: block; height: 100%; background: #9aa8bd; }
.cand.win .bar i { background: var(--accent); }
.cand .v { text-align: end; font-variant-numeric: tabular-nums; }
.cand .v b { font-size: 11pt; }
.tag { display: inline-block; margin-inline-start: 6px; font-size: 7.5pt; font-weight: 700; color: #fff; background: var(--accent); border-radius: 99px; padding: 0 7px; vertical-align: 1px; }
.tag.tie { background: var(--warn); }
.cand.blank { color: var(--muted); }
.tienote { margin: 9px 0 0; padding: 6px 10px; font-size: 9pt; color: var(--warn); background: var(--warn-soft); border-radius: 6px; }
.withheld { margin: 6px 0 2px; color: var(--muted); font-size: 9.5pt; }
.digest { font: 600 9pt/1.5 'PV Sans', monospace; white-space: nowrap; direction: ltr; unicode-bidi: isolate; word-break: break-all; letter-spacing: .02em; }
.sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 22px; margin-top: 10px; }
.sig { break-inside: avoid; }
.sigline { display: flex; align-items: flex-end; gap: 8px; margin-top: 13px; font-size: 9.5pt; }
.sigline .line { flex: 1; border-bottom: 1px solid #1a2233; height: 1px; margin-bottom: 4px; }
.sig .box-sign { height: 34px; }
`;

const FONTS = (): string => `
@font-face { font-family: 'PV Sans'; font-weight: 400; src: url(${dataUri('fonts/NotoSans_400Regular.ttf', 'font/ttf')}); }
@font-face { font-family: 'PV Sans'; font-weight: 700; src: url(${dataUri('fonts/NotoSans_700Bold.ttf', 'font/ttf')}); }
@font-face { font-family: 'PV Naskh'; font-weight: 400; src: url(${dataUri('fonts/NotoNaskhArabic_400Regular.ttf', 'font/ttf')}); }
@font-face { font-family: 'PV Naskh'; font-weight: 700; src: url(${dataUri('fonts/NotoNaskhArabic_700Bold.ttf', 'font/ttf')}); }`;

function renderPosition(p: PvPosition, l: PvLabels, lang: PvLang): string {
  const person = (x: PvPerson) => `<bdi>${esc(lang === 'ar' && x.nameAr ? x.nameAr : x.name)}</bdi>`;
  const title = esc(lang === 'ar' && p.titleAr ? p.titleAr : p.title);
  const head = `<div class="pos-head"><h3>${title}</h3><span class="chip">${esc(l.seats(p.seats))}</span>${p.tie ? `<span class="badge-tie">${esc(l.tieBadge)}</span>` : ''}</div>`;
  if (!p.detailPublished) {
    // D-32 : sous 3 votants, ni voix ni barres, seulement les élus.
    return `<div class="pos">${head}<p class="withheld">${esc(l.withheld)}</p><p><b>${esc(l.winnersOnly)} :</b> ${p.winners.length ? p.winners.map(person).join(l.sep) : l.none}</p></div>`;
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

/** Procès-verbal dans UNE langue (D-42) : HTML autonome (polices et logo intégrés), prêt à être imprimé en PDF par Chromium. */
export function renderPvHtml(data: PvData, lang: PvLang): string {
  const l = PV_LABELS[lang];
  const d = data;
  const local = (name: string, nameAr: string | null) => esc(lang === 'ar' && nameAr ? nameAr : name);
  const stat = (n: string | number, label: string, main = false) => `<div class="stat${main ? ' main' : ''}"><span class="n">${ltr(n)}</span><span class="l">${esc(label)}</span></div>`;
  const sec = (no: string, title: string, body: string) => `<section class="sec"><div class="sec-head"><span class="no">${no}</span><h2>${esc(title)}</h2></div>${body}</section>`;
  const kv = (rows: [string, string][]) => `<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>`;
  const date = (x: Date, zone = true) => ltr(formatPvDate(x, l, zone));

  const calendar =
    kv([[l.votingStart, date(d.votingStartsAt)], [l.votingEnd, date(d.votingEndsAt)], ...(d.publishedAt ? ([[l.publishedAt, date(d.publishedAt)]] as [string, string][]) : [])]) +
    `<div class="box"><h3>${esc(l.incidentTitle)}</h3>${
      d.extension
        ? kv([
            [l.originalEnd, date(d.extension.originalEndsAt)],
            [l.outage, `${l.outageRange(date(d.extension.outageStartedAt, false), date(d.extension.outageEndedAt, false))} ${esc(l.utc)}`],
            [l.newEnd, date(d.extension.newEndsAt)],
            [l.reason, esc(d.extension.reason)],
          ])
        : `<span>${esc(l.noIncident)}</span>`
    }</div>`;

  const signatories = Array.from({ length: Math.max(3, d.committeeSize) }, () => `<div class="sig"><div class="sigline"><span>${esc(l.name)} :</span><span class="line"></span></div><div class="sigline box-sign"><span>${esc(l.signature)} :</span><span class="line"></span></div></div>`).join('');

  return `<!doctype html><html lang="${lang}" dir="${l.dir}"><head><meta charset="utf-8"><title>${esc(l.title)}</title><style>${CSS(FONTS())}
:root { --footer: "${esc(d.verificationCode)} · ${esc(l.page)} "; }</style></head><body>
<header class="top"><img src="${dataUri('branding/logo-fsjp.jpg', 'image/jpeg')}" alt=""><div class="titles"><div class="kicker">${esc(l.documentSubtitle)}</div><h1>${esc(l.title)}</h1></div></header>
<p class="election">${local(d.election.title, d.election.titleAr)}${d.election.round > 1 ? ` — ${esc(l.round(d.election.round))}` : ''}</p>
<p class="institution">${esc(l.institution)} : ${local(d.institution.name, d.institution.nameAr)}</p>
${sec('01', l.s1, `<div class="stats">${stat(d.registered, l.registered)}${stat(d.voters, l.voters)}${stat(d.ballots, l.ballots)}${stat(`${d.turnoutRate} %`, l.turnout, true)}</div>${d.addedAfterFreeze > 0 ? `<p class="note warn">${esc(l.ofWhichAdded(d.addedAfterFreeze))}</p>` : ''}<p class="note">${esc(l.integrityOk)}</p>`)}
${sec('02', l.s2, calendar)}
<section class="sec" style="break-inside:auto"><div class="sec-head"><span class="no">03</span><h2>${esc(l.s3)}</h2></div>${d.positions.map((p) => renderPosition(p, l, lang)).join('')}</section>
${sec('04', l.s4, `<div class="box" style="margin-top:0"><h3>${esc(l.digestTitle)}</h3><div class="digest">${esc(d.ballotsDigest)}</div><p class="note" style="margin-top:4px">${esc(l.digestHelp)}</p></div><div style="height:8px"></div>${kv([[l.reportId, ltr(d.reportId)], [l.verificationCode, ltr(d.verificationCode)], [l.generatedAt, date(d.generatedAt)]])}<div class="box"><h3>${esc(l.signaturesTitle)}</h3><p class="note" style="margin:0">${esc(l.signaturesHelp)}</p><div class="sigs">${signatories}</div></div>`)}
</body></html>`;
}
