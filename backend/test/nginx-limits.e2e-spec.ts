import { readFileSync } from 'fs';
import { join } from 'path';
import { MAX_UPLOAD_BYTES } from '../src/storage/file-validator';

// Dépôt d'attestation (D-23) : l'API refuse > 5 Mo (413 « TOO_LARGE »). nginx doit laisser passer un peu plus (multipart),
// et au-delà répondre LUI-MÊME en JSON, avec le même code, pour que l'interface affiche « Fichier trop volumineux ».
// Ce test lit frontend/nginx.conf (pas d'accès à Docker).
const conf = readFileSync(join(__dirname, '../../frontend/nginx.conf'), 'utf8').replace(/^\s*#.*$/gm, '');

describe('nginx : limite de taille des dépôts', () => {
  it('accepte un peu plus que le plafond de l’API, sans que nginx réponde avant elle pour 5-6 Mo', () => {
    const limit = /client_max_body_size\s+(\d+)m;/.exec(conf);
    expect(limit).not.toBeNull();
    expect(Number(limit![1]) * 1024 * 1024).toBeGreaterThan(MAX_UPLOAD_BYTES);
  });

  it('répond 413 en JSON, au format d’erreur de l’API et avec le code TOO_LARGE', () => {
    expect(conf).toMatch(/error_page\s+413\s+@too_large;/);
    const block = /location\s+@too_large\s*\{([\s\S]*?)\n\s*\}/.exec(conf);
    expect(block).not.toBeNull();
    expect(block![1]).toContain('default_type application/json');
    const ret = /return\s+413\s+'([^']+)';/.exec(block![1]);
    expect(ret).not.toBeNull();
    const body = JSON.parse(ret![1].replace('$time_iso8601', '2026-01-01T00:00:00+00:00'));
    expect(body).toEqual({ statusCode: 413, message: 'TOO_LARGE', timestamp: '2026-01-01T00:00:00+00:00' });
  });
});
