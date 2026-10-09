import { Injectable } from '@nestjs/common';

/**
 * Verrou par compte contre le brute-force du mot de passe ou du code TOTP, en plus du throttling par IP
 * (un attaquant qui change d'IP resterait bloqué). Mémoire du processus : ne se partage pas entre instances.
 */
@Injectable()
export class LoginAttemptLimiter {
  private readonly attempts = new Map<string, { count: number; since: number }>();

  max = 5;
  windowMs = 15 * 60_000;

  isLocked(userId: string, now = Date.now()): boolean {
    const entry = this.attempts.get(userId);
    if (!entry) return false;
    if (now - entry.since > this.windowMs) {
      this.attempts.delete(userId);
      return false;
    }
    return entry.count >= this.max;
  }

  fail(userId: string, now = Date.now()): void {
    const entry = this.attempts.get(userId);
    if (!entry || now - entry.since > this.windowMs) this.attempts.set(userId, { count: 1, since: now });
    else entry.count++;
  }

  reset(userId: string): void {
    this.attempts.delete(userId);
  }
}
