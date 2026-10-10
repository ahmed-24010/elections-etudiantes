import request from 'supertest';
import { createTestApp, TestContext } from './helpers';

// /auth/login est limité à 10 requêtes par minute et par IP (AuthController). Derrière nginx, l'IP réelle du client
// n'est visible que si Express fait confiance au proxy (TRUST_PROXY=1, docker-compose.yml). Ces tests utilisent la même
// configuration HTTP que main.ts (configureApp) avec les deux valeurs de TRUST_PROXY.
const login = (t: TestContext, forwardedFor: string) =>
  request(t.app.getHttpServer())
    .post('/api/v1/auth/login')
    .set('x-forwarded-for', forwardedFor)
    .send({ identifier: 'personne@example.test', password: 'mauvais-mot-de-passe' });

async function hammer(t: TestContext, forwardedFor: string, count: number): Promise<number[]> {
  const statuses: number[] = [];
  for (let i = 0; i < count; i++) statuses.push((await login(t, forwardedFor)).status);
  return statuses;
}

describe('Limitation de débit et IP réelle derrière nginx (TRUST_PROXY)', () => {
  describe('TRUST_PROXY=1 (docker-compose : nginx devant l’API)', () => {
    let t: TestContext;
    beforeAll(async () => {
      t = await createTestApp({ trustProxy: 1 });
    });
    afterAll(() => t.app.close());

    it('chaque client réel a son propre quota : un client qui abuse n’en bloque pas un autre', async () => {
      const abuser = await hammer(t, '203.0.113.10', 12);
      expect(abuser.slice(0, 10)).toEqual(Array(10).fill(401));
      expect(abuser.slice(10)).toEqual([429, 429]);
      // Un autre client, derrière le même nginx, n'est pas touché.
      expect((await login(t, '203.0.113.11')).status).toBe(401);
    });

    it('un client ne peut pas échapper à la limite en forgeant X-Forwarded-For (nginx ajoute l’IP réelle à droite)', async () => {
      // Le client envoie une fausse IP en tête ; nginx ($proxy_add_x_forwarded_for) ajoute son adresse réelle à la fin.
      const statuses: number[] = [];
      for (let i = 0; i < 12; i++) statuses.push((await login(t, `198.51.100.${i + 1}, 203.0.113.20`)).status);
      expect(statuses.slice(10)).toEqual([429, 429]);
    });
  });

  describe('TRUST_PROXY=0 (sans proxy de confiance)', () => {
    let t: TestContext;
    beforeAll(async () => {
      t = await createTestApp({ trustProxy: 0 });
    });
    afterAll(() => t.app.close());

    it('l’en-tête X-Forwarded-For est ignoré : tous les clients partagent l’IP de la connexion (le piège à éviter derrière nginx)', async () => {
      const first = await hammer(t, '203.0.113.30', 10);
      expect(first).toEqual(Array(10).fill(401));
      // Une autre « IP » annoncée tombe dans le MÊME quota : sans TRUST_PROXY, le premier client bloquerait tout le monde.
      expect((await login(t, '203.0.113.31')).status).toBe(429);
    });
  });
});
