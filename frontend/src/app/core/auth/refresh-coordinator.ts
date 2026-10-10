/** Message échangé entre les onglets (BroadcastChannel). Il transporte un jeton d'accès (15 min), jamais le refresh token. */
export type TabMessage = { type: 'token'; token: string } | { type: 'logout' };

/** Pont BroadcastChannel entre les onglets d'un même navigateur. Sans BroadcastChannel, il ne fait rien. */
export class TabSync {
  private readonly channel?: BroadcastChannel;

  constructor(
    name: string,
    onMessage: (m: TabMessage) => void,
  ) {
    if (typeof BroadcastChannel !== 'undefined') {
      this.channel = new BroadcastChannel(name);
      this.channel.onmessage = (e: MessageEvent<TabMessage>) => onMessage(e.data);
    }
  }

  post(message: TabMessage): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      /* canal déjà fermé (service détruit pendant une requête) : rien à synchroniser */
    }
  }

  close(): void {
    this.channel?.close();
  }
}

export interface RefreshCoordinatorOptions {
  /** Nom du verrou Web Locks, commun à tous les onglets de l'origine. */
  lockName: string;
  /** Surchargeable pour les tests ; `undefined` force le mode sans Web Locks. */
  locks?: Pick<LockManager, 'request'> | null;
  /** Pause aléatoire avant le renouvellement en mode sans Web Locks (ms). */
  jitter?: () => number;
}

/**
 * Coordonne le renouvellement du jeton d'accès entre les onglets.
 *
 * Problème : le refresh token est à usage unique (rotation) et présenter un token déjà consommé révoque toute la
 * session (vol présumé). Deux onglets qui se renouvellent en même temps envoient le MÊME cookie : le second est vu
 * comme un rejeu et déconnecte l'étudiant partout.
 *
 * Solution :
 * 1. dans un onglet, un seul renouvellement à la fois (les appels concurrents partagent la même promesse) ;
 * 2. entre onglets, un verrou Web Locks sérialise les renouvellements : le second onglet envoie le cookie déjà
 *    tourné par le premier, donc valide ;
 * 3. si un autre onglet vient de publier un jeton pendant l'attente du verrou, on l'adopte sans appeler le serveur ;
 * 4. sans Web Locks (très anciens navigateurs), on ne peut pas garantir l'exclusion : on attend une courte pause
 *    aléatoire et on adopte le jeton d'un autre onglet s'il vient d'en publier un, ce qui réduit fortement la
 *    fenêtre de collision sans la supprimer. (Un rejeu ne se rattrape pas : le serveur révoque alors la session.)
 */
export class RefreshCoordinator {
  private inflight?: Promise<string>;
  private foreignTokenAt = 0;
  private readonly locks: Pick<LockManager, 'request'> | null;

  constructor(
    private readonly refreshCall: () => Promise<string>,
    private readonly currentToken: () => string | null,
    private readonly options: RefreshCoordinatorOptions,
  ) {
    this.locks = options.locks !== undefined ? options.locks : typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null;
  }

  /** À appeler quand un autre onglet publie un jeton frais. */
  noteForeignToken(): void {
    this.foreignTokenAt = Date.now();
  }

  refresh(): Promise<string> {
    this.inflight ??= this.run().finally(() => (this.inflight = undefined));
    return this.inflight;
  }

  private async run(): Promise<string> {
    const startedAt = Date.now();
    const work = async (): Promise<string> => {
      const adopted = this.currentToken();
      if (this.foreignTokenAt >= startedAt && adopted) return adopted; // un autre onglet a déjà renouvelé
      return this.refreshCall();
    };
    if (this.locks) return (await this.locks.request(this.options.lockName, work)) as string;
    return this.withoutLocks(startedAt);
  }

  private async withoutLocks(startedAt: number): Promise<string> {
    const delay = this.options.jitter ? this.options.jitter() : Math.random() * 400;
    await new Promise((resolve) => setTimeout(resolve, delay));
    const adopted = this.currentToken();
    if (this.foreignTokenAt >= startedAt && adopted) return adopted;
    return this.refreshCall();
  }
}
