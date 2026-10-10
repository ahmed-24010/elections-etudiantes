/** Limites et contrôle du contenu des attestations déposées (D-23). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export type FileRejection = 'EMPTY' | 'TOO_LARGE' | 'UNSUPPORTED_TYPE' | 'CORRUPTED' | 'ACTIVE_CONTENT';

export class FileRejected extends Error {
  constructor(readonly reason: FileRejection) {
    super(reason);
  }
}

export interface DetectedFile {
  mime: 'application/pdf' | 'image/jpeg' | 'image/png';
  ext: 'pdf' | 'jpg' | 'png';
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IEND = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

// Marqueurs de contenu actif visibles dans le corps du PDF. Détection de SURFACE : des objets compressés peuvent les
// cacher. La vraie protection est que le serveur n'interprète jamais le fichier et le sert en `sandbox` + `nosniff`.
const PDF_ACTIVE = /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|SubmitForm)(?![A-Za-z])/;

/** Retire les octets de bourrage (0x00, espaces, sauts de ligne) à la fin d'un fichier. */
function trimTail(buf: Buffer): Buffer {
  let end = buf.length;
  while (end > 0 && (buf[end - 1] === 0x00 || buf[end - 1] === 0x0a || buf[end - 1] === 0x0d || buf[end - 1] === 0x20)) end--;
  return buf.subarray(0, end);
}

/**
 * Reconnaît le type RÉEL d'après le contenu (signature d'en-tête ET marqueur de fin), jamais d'après l'extension ni le
 * Content-Type envoyés par le client. Lève FileRejected si le fichier est vide, trop gros, d'un autre type ou tronqué.
 */
export function detectFile(buf: Buffer): DetectedFile {
  if (buf.length === 0) throw new FileRejected('EMPTY');
  if (buf.length > MAX_UPLOAD_BYTES) throw new FileRejected('TOO_LARGE');

  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') {
    if (!trimTail(buf).subarray(-1024).toString('latin1').includes('%%EOF')) throw new FileRejected('CORRUPTED');
    if (PDF_ACTIVE.test(buf.toString('latin1'))) throw new FileRejected('ACTIVE_CONTENT');
    return { mime: 'application/pdf', ext: 'pdf' };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    const t = trimTail(buf);
    if (!(t[t.length - 2] === 0xff && t[t.length - 1] === 0xd9)) throw new FileRejected('CORRUPTED');
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (buf.length >= PNG_SIGNATURE.length && buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    if (buf.subarray(12, 16).toString('latin1') !== 'IHDR' || !trimTail(buf).subarray(-12).equals(PNG_IEND)) throw new FileRejected('CORRUPTED');
    return { mime: 'image/png', ext: 'png' };
  }
  throw new FileRejected('UNSUPPORTED_TYPE');
}

/** Nom d'origine, conservé uniquement comme métadonnée d'affichage : jamais utilisé dans un chemin ni un en-tête brut. */
export function sanitizeOriginalName(name: string | undefined): string {
  const base = (name ?? '').split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f"<>|:*?]/g, '').trim().slice(0, 120);
  return clean || 'document';
}
