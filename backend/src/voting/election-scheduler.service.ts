import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ElectionsService } from '../elections/elections.service';
import { VotingLifecycleService } from './voting-lifecycle.service';

/**
 * Tâche planifiée (04 §3, §4.2 à §4.4) : clôture des candidatures, ouverture et clôture du vote à l'heure de la base.
 * Désactivée en test (SCHEDULER_ENABLED=false ou NODE_ENV=test) pour ne pas transformer les élections fabriquées par les
 * tests ; les tests appellent `runDueTransitions` eux-mêmes.
 */
@Injectable()
export class ElectionSchedulerService {
  private readonly logger = new Logger(ElectionSchedulerService.name);
  private running = false;

  constructor(
    private readonly lifecycle: VotingLifecycleService,
    private readonly elections: ElectionsService,
    private readonly config: ConfigService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async onTick() {
    if (this.config.get('NODE_ENV') === 'test' || this.config.get('SCHEDULER_ENABLED') === 'false') return;
    await this.runDueTransitions();
  }

  async runDueTransitions() {
    if (this.running) return; // un tick lent ne doit pas se chevaucher
    this.running = true;
    try {
      await this.lifecycle.runDueTransitions((id) => this.elections.closeCandidacyAutomatically(id));
    } catch (e) {
      this.logger.error(`Tâche planifiée en échec : ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.running = false;
    }
  }
}
