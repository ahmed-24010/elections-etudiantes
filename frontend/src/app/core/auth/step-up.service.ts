import { Injectable, inject, signal } from '@angular/core';
import { isStepUpRequired } from './api-error';
import { AuthService } from './auth.service';

/** Raison pour laquelle une action 🔐 n'a pas abouti parce que l'utilisateur a fermé la fenêtre du code. */
export class StepUpCancelled extends Error {
  constructor() {
    super('step_up_cancelled');
  }
}

interface Pending {
  resolve: () => void;
  reject: (e: unknown) => void;
}

/**
 * Actions sensibles (🔐) : le serveur répond 401 `step_up_required` si la 2FA date de plus de 10 minutes.
 * `run` lance l'action ; sur ce 401, il ouvre la fenêtre de saisie du code (StepUpDialog), valide le code auprès du
 * serveur (`/auth/step-up`) puis rejoue l'action UNE fois. Le code n'est jamais conservé.
 */
@Injectable({ providedIn: 'root' })
export class StepUpService {
  private readonly auth = inject(AuthService);

  /** Non nul tant que la fenêtre est ouverte. */
  readonly pending = signal<Pending | null>(null);

  async run<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (e) {
      if (!isStepUpRequired(e)) throw e;
    }
    await this.ask();
    return action();
  }

  /** Vérifie le code saisi ; en cas d'erreur la fenêtre reste ouverte (l'erreur remonte à la fenêtre). */
  async submit(code: string): Promise<void> {
    await this.auth.stepUp(code);
    this.settle((p) => p.resolve());
  }

  cancel(): void {
    this.settle((p) => p.reject(new StepUpCancelled()));
  }

  private ask(): Promise<void> {
    // Une seule fenêtre à la fois : une demande déjà ouverte est annulée.
    this.cancel();
    return new Promise<void>((resolve, reject) => this.pending.set({ resolve, reject }));
  }

  private settle(f: (p: Pending) => void): void {
    const p = this.pending();
    this.pending.set(null);
    if (p) f(p);
  }
}
