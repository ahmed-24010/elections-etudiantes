import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { Browser } from 'puppeteer-core';

/**
 * HTML → PDF par Chromium (D-43) : le rendu de l'arabe (liaison des lettres, sens, mélange avec des noms latins) est celui
 * d'un navigateur. Le chemin de Chromium vient de `CHROMIUM_PATH` ; le navigateur est lancé à la demande et réutilisé.
 * Il n'ouvre aucune URL : le HTML est autonome (polices et logo intégrés) et JavaScript est désactivé.
 */
@Injectable()
export class PvPdfService implements OnModuleDestroy {
  private readonly logger = new Logger(PvPdfService.name);
  private browser: Promise<Browser> | undefined;

  constructor(private readonly executablePath: string | undefined = process.env.CHROMIUM_PATH) {}

  private launch(): Promise<Browser> {
    if (!this.executablePath) throw new Error('CHROMIUM_PATH non défini : impossible de générer le procès-verbal.');
    this.browser ??= puppeteer
      .launch({ executablePath: this.executablePath, headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] })
      .catch((e) => {
        this.browser = undefined;
        throw e;
      });
    return this.browser;
  }

  async pdf(html: string): Promise<Buffer> {
    const browser = await this.launch();
    const page = await browser.newPage();
    try {
      await page.setJavaScriptEnabled(false);
      await page.setContent(html, { waitUntil: 'load' });
      return Buffer.from(await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }));
    } finally {
      await page.close().catch((e) => this.logger.warn(`Fermeture de page : ${String(e)}`));
    }
  }

  async onModuleDestroy() {
    if (this.browser) await (await this.browser).close().catch(() => undefined);
  }
}
