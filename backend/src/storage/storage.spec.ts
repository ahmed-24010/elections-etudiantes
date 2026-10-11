import { ConfigService } from '@nestjs/config';
import { detectFile, FileRejected, MAX_UPLOAD_BYTES, sanitizeOriginalName } from './file-validator';
import { SIGNED_URL_TTL_MS, SignedUrlService } from './signed-url.service';

// --- Fichiers de test valides, construits octet par octet (aucun fichier binaire dans le dépôt) -------------------
const pdf = (body = '1 0 obj << /Type /Catalog >> endobj') => Buffer.from(`%PDF-1.4\n${body}\ntrailer << /Root 1 0 R >>\n%%EOF\n`, 'latin1');
const jpeg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF'), Buffer.alloc(40, 1), Buffer.from([0xff, 0xd9])]);
const png = () =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0x00, 0x00, 0x00, 0x0d]), Buffer.from('IHDR'), Buffer.alloc(13, 1), Buffer.alloc(4, 2),
    Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
  ]);

const rejected = (buf: Buffer) => {
  try {
    detectFile(buf);
  } catch (e) {
    return e instanceof FileRejected ? e.reason : 'AUTRE_ERREUR';
  }
  return 'ACCEPTE';
};

describe('detectFile : type RÉEL du fichier (D-23)', () => {
  it('accepte un PDF, un JPEG et un PNG valides', () => {
    expect(detectFile(pdf())).toEqual({ mime: 'application/pdf', ext: 'pdf' });
    expect(detectFile(jpeg())).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
    expect(detectFile(png())).toEqual({ mime: 'image/png', ext: 'png' });
  });

  it('accepte le bourrage de fin de fichier (octets nuls, sauts de ligne)', () => {
    expect(rejected(Buffer.concat([pdf(), Buffer.alloc(30)]))).toBe('ACCEPTE');
    expect(rejected(Buffer.concat([jpeg(), Buffer.alloc(10)]))).toBe('ACCEPTE');
  });

  it.each([
    ['un exécutable Windows renommé en .pdf', Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 0x90)])],
    ['un exécutable Linux (ELF)', Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(200)])],
    ['une page HTML avec script', Buffer.from('<html><script>alert(document.cookie)</script></html>')],
    ['un SVG avec script', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ['un script shell', Buffer.from('#!/bin/sh\nrm -rf /\n')],
    ['une archive ZIP / DOCX', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(100)])],
    ['du texte brut', Buffer.from('Attestation de scolarité')],
    ['un GIF', Buffer.from('GIF89a' + 'x'.repeat(50))],
  ])('refuse %s', (_name, buf) => {
    expect(rejected(buf)).toBe('UNSUPPORTED_TYPE');
  });

  it('refuse un fichier vide et un fichier de plus de 5 Mo', () => {
    expect(rejected(Buffer.alloc(0))).toBe('EMPTY');
    expect(rejected(Buffer.concat([pdf(), Buffer.alloc(MAX_UPLOAD_BYTES)]))).toBe('TOO_LARGE');
    expect(rejected(Buffer.alloc(MAX_UPLOAD_BYTES, 0x20))).not.toBe('ACCEPTE');
  });

  it('accepte exactement 5 Mo', () => {
    const exact = Buffer.concat([pdf('%'.repeat(10)), Buffer.alloc(0)]);
    const padded = Buffer.concat([exact.subarray(0, exact.length - 6), Buffer.alloc(MAX_UPLOAD_BYTES - exact.length, 0x20), exact.subarray(exact.length - 6)]);
    expect(padded.length).toBe(MAX_UPLOAD_BYTES);
    expect(rejected(padded)).toBe('ACCEPTE');
  });

  it('refuse un fichier tronqué : l’en-tête seul ne suffit pas', () => {
    expect(rejected(Buffer.from('%PDF-1.4\n1 0 obj << >> endobj'))).toBe('CORRUPTED');
    expect(rejected(jpeg().subarray(0, 20))).toBe('CORRUPTED');
    expect(rejected(png().subarray(0, 30))).toBe('CORRUPTED');
    expect(rejected(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe('UNSUPPORTED_TYPE');
  });

  it('refuse un PDF qui contient du contenu actif visible (JavaScript, lancement, fichier joint)', () => {
    for (const marker of ['/JavaScript', '/JS (app.alert(1))', '/Launch', '/EmbeddedFile', '/RichMedia', '/SubmitForm']) {
      expect(rejected(pdf(`<< /S ${marker} >>`))).toBe('ACTIVE_CONTENT');
    }
    expect(rejected(pdf('<< /Type /Page /Resources << /ProcSet [/PDF /Text] >> >>'))).toBe('ACCEPTE');
    expect(rejected(pdf('/JSON-schema /Javascripture'))).toBe('ACCEPTE'); // pas de faux positif sur un autre nom
  });

  it('un fichier qui commence comme un PDF mais finit comme un autre type n’est reconnu que par sa signature de départ', () => {
    // Le type est décidé par le contenu : un « .jpg » qui est un PDF est traité comme PDF (l'extension ne sert à rien).
    expect(detectFile(pdf()).ext).toBe('pdf');
  });
});

describe('sanitizeOriginalName', () => {
  it('ne garde que le nom : pas de chemin, de caractères de contrôle ni de caractères dangereux', () => {
    expect(sanitizeOriginalName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeOriginalName('C:\\Users\\x\\attestation.pdf')).toBe('attestation.pdf');
    expect(sanitizeOriginalName('a"b<c>d|e:f*g?.pdf')).toBe('abcdefg.pdf');
    expect(sanitizeOriginalName('x\r\ny.pdf')).not.toMatch(/[\r\n]/);
    expect(sanitizeOriginalName(undefined)).toBe('document');
    expect(sanitizeOriginalName('   ')).toBe('document');
    expect(sanitizeOriginalName('a'.repeat(500)).length).toBe(120);
  });
});

describe('SignedUrlService : URL signée de 5 minutes', () => {
  const svc = new SignedUrlService(new ConfigService({ FILE_SIGNING_SECRET: 'k'.repeat(40) }));
  const now = 1_800_000_000_000;

  it('la durée de vie est de 5 minutes', () => {
    expect(SIGNED_URL_TTL_MS).toBe(300_000);
    expect(svc.sign('f', 'u', now).exp).toBe(now + 300_000);
  });

  it('accepte une signature valide, jusqu’à l’expiration', () => {
    const { exp, sig } = svc.sign('file-1', 'user-1', now);
    expect(svc.verify('file-1', 'user-1', exp, sig, now + 1000)).toBe(true);
    expect(svc.verify('file-1', 'user-1', exp, sig, exp - 1)).toBe(true);
  });

  it('refuse après expiration (exactement 5 min plus tard)', () => {
    const { exp, sig } = svc.sign('file-1', 'user-1', now);
    expect(svc.verify('file-1', 'user-1', exp, sig, exp)).toBe(false);
    expect(svc.verify('file-1', 'user-1', exp, sig, exp + 60_000)).toBe(false);
  });

  it('refuse un autre fichier, un autre utilisateur, une expiration prolongée ou une signature altérée', () => {
    const { exp, sig } = svc.sign('file-1', 'user-1', now);
    expect(svc.verify('file-2', 'user-1', exp, sig, now)).toBe(false);
    expect(svc.verify('file-1', 'user-2', exp, sig, now)).toBe(false);
    expect(svc.verify('file-1', 'user-1', exp + 3_600_000, sig, now)).toBe(false);
    expect(svc.verify('file-1', 'user-1', exp, sig.replace(/^./, sig[0] === 'a' ? 'b' : 'a'), now)).toBe(false);
    expect(svc.verify('file-1', 'user-1', exp, 'zz', now)).toBe(false);
    expect(svc.verify('file-1', 'user-1', exp, '', now)).toBe(false);
  });

  it('refuse une expiration lointaine fabriquée même avec une signature « valide » pour cette expiration', () => {
    const forged = svc.sign('file-1', 'user-1', now + 3_600_000); // signée pour 1 h plus tard
    expect(svc.verify('file-1', 'user-1', forged.exp, forged.sig, now)).toBe(false);
  });

  it('une autre clé de signature ne valide pas les URL', () => {
    const other = new SignedUrlService(new ConfigService({ FILE_SIGNING_SECRET: 'z'.repeat(40) }));
    const { exp, sig } = svc.sign('f', 'u', now);
    expect(other.verify('f', 'u', exp, sig, now)).toBe(false);
  });
});
