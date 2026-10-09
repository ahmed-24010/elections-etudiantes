import { RefreshCoordinator, TabSync } from './refresh-coordinator';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let seq = 0;
const unique = (prefix: string) => `${prefix}-${Date.now()}-${++seq}`;

/**
 * Faux serveur qui se comporte comme le vrai /auth/refresh : le cookie de refresh est à usage unique (rotation) ;
 * présenter un cookie déjà consommé révoque TOUTE la session, pour tous les onglets.
 */
class FakeServer {
  /** Le cookie courant, partagé par tous les onglets (un navigateur n'a qu'un seul cookie jar). */
  cookie = 'c0';
  revoked = false;
  calls = 0;
  private rotations = 0;
  private readonly consumed = new Set<string>();

  async refresh(presented: string): Promise<string> {
    this.calls++;
    if (this.revoked) throw new Error('401 session révoquée');
    if (presented !== this.cookie || this.consumed.has(presented)) {
      this.revoked = true; // rejeu : vol présumé, toute la famille est révoquée
      throw new Error('401 rejeu du refresh token');
    }
    this.consumed.add(presented);
    this.cookie = `c${++this.rotations}`;
    return `access-${this.cookie}`;
  }
}

interface Tab {
  coordinator: RefreshCoordinator;
  token: () => string | null;
  /** Simule la réception d'un message « jeton frais » envoyé par un autre onglet. */
  deliver: (t: string) => void;
  close: () => void;
}

/** Un « onglet » : sa propre mémoire de jeton, son coordinateur, son canal BroadcastChannel. */
function makeTab(server: FakeServer, opts: { lockName: string; channel: string; locks?: null; jitter?: () => number; latency?: number }): Tab {
  let token: string | null = null;
  const coordinator = new RefreshCoordinator(
    async () => {
      const sent = server.cookie; // le navigateur joint le cookie AU DÉPART de la requête…
      await sleep(opts.latency ?? 25); // …le serveur la traite plus tard (latence réseau)
      const fresh = await server.refresh(sent);
      token = fresh;
      sync.post({ type: 'token', token: fresh });
      return fresh;
    },
    () => token,
    { lockName: opts.lockName, locks: opts.locks, jitter: opts.jitter },
  );
  const sync = new TabSync(opts.channel, (m) => {
    if (m.type === 'token') {
      token = m.token;
      coordinator.noteForeignToken();
    }
  });
  const deliver = (t: string) => {
    token = t;
    coordinator.noteForeignToken();
  };
  return { coordinator, token: () => token, deliver, close: () => sync.close() };
}

describe('RefreshCoordinator : plusieurs onglets ouverts', () => {
  it('SANS coordination, deux onglets qui se renouvellent ensemble déclenchent un rejeu et révoquent la session (le problème)', async () => {
    const server = new FakeServer();
    const call = async () => {
      const sent = server.cookie;
      await sleep(25);
      return server.refresh(sent);
    };
    const results = await Promise.allSettled([call(), call()]);
    expect(results.some((r) => r.status === 'rejected')).toBeTrue();
    expect(server.revoked).toBeTrue();
  });

  it('AVEC Web Locks, deux onglets simultanés ne sont jamais déconnectés', async () => {
    const server = new FakeServer();
    const lockName = unique('lock');
    const channel = unique('chan');
    const a = makeTab(server, { lockName, channel });
    const b = makeTab(server, { lockName, channel });
    try {
      const [ta, tb] = await Promise.all([a.coordinator.refresh(), b.coordinator.refresh()]);
      expect(server.revoked).toBeFalse();
      expect(ta).toBeTruthy();
      expect(tb).toBeTruthy();
      // Les deux onglets ont un jeton utilisable, et le cookie a tourné proprement (1 ou 2 fois, jamais de rejeu).
      expect(server.calls).toBeLessThanOrEqual(2);
      await sleep(30);
      expect(a.token()).toBe(b.token());
    } finally {
      a.close();
      b.close();
    }
  });

  it('cinq onglets qui se renouvellent à la fois : aucune révocation', async () => {
    const server = new FakeServer();
    const lockName = unique('lock');
    const channel = unique('chan');
    const tabs = Array.from({ length: 5 }, () => makeTab(server, { lockName, channel, latency: 15 }));
    try {
      const tokens = await Promise.all(tabs.map((t) => t.coordinator.refresh()));
      expect(server.revoked).toBeFalse();
      expect(tokens.every(Boolean)).toBeTrue();
    } finally {
      tabs.forEach((t) => t.close());
    }
  });

  it('plusieurs renouvellements successifs depuis deux onglets (jetons expirant à tour de rôle)', async () => {
    const server = new FakeServer();
    const lockName = unique('lock');
    const channel = unique('chan');
    const a = makeTab(server, { lockName, channel });
    const b = makeTab(server, { lockName, channel });
    try {
      for (let i = 0; i < 4; i++) {
        await Promise.all([a.coordinator.refresh(), b.coordinator.refresh()]);
        await sleep(10);
      }
      expect(server.revoked).toBeFalse();
    } finally {
      a.close();
      b.close();
    }
  });

  it('un onglet qui attendait le verrou adopte le jeton publié par l’autre sans appeler le serveur', async () => {
    const server = new FakeServer();
    const lockName = unique('lock');
    const tab = makeTab(server, { lockName, channel: unique('chan') });
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    // Un « autre onglet » détient le verrou pendant son propre renouvellement.
    const other = navigator.locks.request(lockName, () => held);
    await sleep(5);

    const waiting = tab.coordinator.refresh(); // attend le verrou
    await sleep(5);
    // Pendant l'attente, l'autre onglet publie un jeton frais (message BroadcastChannel reçu).
    tab.deliver('jeton-publie-par-l-autre-onglet');
    release();
    await other;

    expect(await waiting).toBe('jeton-publie-par-l-autre-onglet');
    expect(server.calls).toBe(0);
    tab.close();
  });

  it('appels concurrents dans le MÊME onglet : une seule requête de renouvellement', async () => {
    const server = new FakeServer();
    const tab = makeTab(server, { lockName: unique('lock'), channel: unique('chan') });
    try {
      const results = await Promise.all([tab.coordinator.refresh(), tab.coordinator.refresh(), tab.coordinator.refresh()]);
      expect(new Set(results).size).toBe(1);
      expect(server.calls).toBe(1);
    } finally {
      tab.close();
    }
  });

  it('sans Web Locks : la pause aléatoire + l’adoption du jeton de l’autre onglet évitent le rejeu', async () => {
    const server = new FakeServer();
    const channel = unique('chan');
    const fast = makeTab(server, { lockName: 'inutilisé', channel, locks: null, jitter: () => 0 });
    const slow = makeTab(server, { lockName: 'inutilisé', channel, locks: null, jitter: () => 120 });
    try {
      const [t1, t2] = await Promise.all([fast.coordinator.refresh(), slow.coordinator.refresh()]);
      expect(server.revoked).toBeFalse();
      expect(server.calls).toBe(1); // le second onglet a adopté le jeton du premier
      expect(t2).toBe(t1);
    } finally {
      fast.close();
      slow.close();
    }
  });

  it('un échec de renouvellement est propagé (session réellement expirée) et n’empêche pas le suivant', async () => {
    const server = new FakeServer();
    server.revoked = true;
    const tab = makeTab(server, { lockName: unique('lock'), channel: unique('chan') });
    try {
      await expectAsync(tab.coordinator.refresh()).toBeRejected();
      await expectAsync(tab.coordinator.refresh()).toBeRejected();
      expect(server.calls).toBe(2);
    } finally {
      tab.close();
    }
  });
});
