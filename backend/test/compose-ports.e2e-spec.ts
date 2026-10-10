import { readFileSync } from 'fs';
import { join } from 'path';

// D-20 : en développement, aucun port n'est publié hors 127.0.0.1. Avec TRUST_PROXY=1 l'API fait confiance à
// X-Forwarded-For : un port du backend joignable depuis le réseau permettrait de forger l'IP et d'échapper au rate limiting ;
// MySQL et S3 exposés au réseau local seraient aussi attaquables. Ce test lit docker-compose.yml (pas d'accès à Docker).

const LOOPBACK = /^127\.0\.0\.1:/;

/** Entrées `ports:` de chaque service (formes inline `["a:b"]` et liste `- "a:b"`). */
export function publishedPorts(compose: string): Array<{ service: string; port: string }> {
  const found: Array<{ service: string; port: string }> = [];
  let service = '';
  let inPortsBlock = false;
  let inServices = false;
  for (const raw of compose.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '');
    if (/^services:\s*$/.test(line)) inServices = true;
    else if (/^\S/.test(line)) inServices = false;
    if (!inServices) continue;
    const svc = /^ {2}([\w-]+):\s*$/.exec(line);
    if (svc) {
      service = svc[1];
      inPortsBlock = false;
      continue;
    }
    const inline = /^\s+ports:\s*\[(.*)\]\s*$/.exec(line);
    if (inline) {
      for (const m of inline[1].matchAll(/["']?([^",'\s][^",']*)["']?\s*(?:,|$)/g)) found.push({ service, port: m[1].trim() });
      continue;
    }
    if (/^\s+ports:\s*$/.test(line)) {
      inPortsBlock = true;
      continue;
    }
    if (inPortsBlock) {
      const item = /^\s+-\s*["']?([^"'\s]+)["']?\s*$/.exec(line);
      if (item) found.push({ service, port: item[1] });
      else if (line.trim() !== '') inPortsBlock = false;
    }
  }
  return found;
}

/** Ports non conformes : tout ce qui n'est pas explicitement lié à 127.0.0.1 (y compris « 3000:3000 » et « 3000 »). */
export function violations(compose: string): string[] {
  const bad = publishedPorts(compose)
    .filter((p) => !LOOPBACK.test(p.port))
    .map((p) => `${p.service}: ${p.port}`);
  for (const m of compose.matchAll(/network_mode:\s*["']?host["']?/g)) bad.push(`network_mode: ${m[0]}`);
  return bad;
}

describe('docker-compose.yml : aucun port publié hors 127.0.0.1 (D-20)', () => {
  const compose = readFileSync(join(__dirname, '..', '..', 'docker-compose.yml'), 'utf8');

  it('tous les ports publiés sont liés à 127.0.0.1', () => {
    expect(violations(compose)).toEqual([]);
  });

  it('le test voit bien les ports (garde-fou contre un parseur aveugle)', () => {
    const ports = publishedPorts(compose);
    expect(ports.map((p) => p.service).sort()).toEqual(['backend', 'db', 's3', 'frontend'].sort());
    expect(ports.find((p) => p.service === 'backend')?.port).toBe('127.0.0.1:3000:3000');
  });

  describe('le détecteur échoue sur les mauvaises formes', () => {
    const wrap = (ports: string) => `services:\n  web:\n    image: x\n    ${ports}\n  other:\n    image: y\n`;
    it.each([
      ['inline sans IP', 'ports: ["3000:3000"]', 'web: 3000:3000'],
      ['inline 0.0.0.0', 'ports: ["0.0.0.0:3000:3000"]', 'web: 0.0.0.0:3000:3000'],
      ['inline port seul', 'ports: ["3000"]', 'web: 3000'],
      ['une seule entrée fautive parmi deux', 'ports: ["127.0.0.1:80:80", "443:443"]', 'web: 443:443'],
      ['liste YAML', 'ports:\n      - "8080:80"', 'web: 8080:80'],
      ['liste YAML sans guillemets', 'ports:\n      - 8080:80', 'web: 8080:80'],
      ['IPv6 joker', 'ports: ["[::]:3000:3000"]', 'web: [::]:3000:3000'],
      ['mode réseau hôte', 'network_mode: host', 'network_mode: network_mode: host'],
    ])('%s', (_name, ports, expected) => {
      expect(violations(wrap(ports))).toEqual([expected]);
    });

    it('accepte 127.0.0.1 en inline et en liste', () => {
      expect(violations(wrap('ports: ["127.0.0.1:3000:3000"]'))).toEqual([]);
      expect(violations(wrap('ports:\n      - "127.0.0.1:3000:3000"'))).toEqual([]);
    });
  });
});
