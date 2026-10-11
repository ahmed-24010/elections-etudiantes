import { Component, ElementRef, afterNextRender, inject, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

let nextId = 0;

/**
 * Fenêtre modale (formulaires d'ajout / modification, confirmations). Le contenu va dans le corps ; les boutons dans
 * l'emplacement `[modal-footer]`. Échap, la croix et un clic sur le fond la ferment (`closed`).
 */
@Component({
  selector: 'app-modal',
  imports: [TranslocoPipe],
  template: `
    <div class="modal-backdrop fade show"></div>
    <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" [attr.aria-labelledby]="titleId" (keydown.escape)="closed.emit()" (mousedown)="onBackdrop($event)">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
        <div class="modal-content app-card">
          <div class="modal-header">
            <h2 class="modal-title h5 app-page-title" [id]="titleId">{{ title() }}</h2>
            <button type="button" class="btn-close" [attr.aria-label]="'common.close' | transloco" (click)="closed.emit()"></button>
          </div>
          <div class="modal-body"><ng-content /></div>
          <div class="modal-footer"><ng-content select="[modal-footer]" /></div>
        </div>
      </div>
    </div>
  `,
})
export class AppModal {
  /** Titre déjà traduit. */
  readonly title = input.required<string>();
  readonly closed = output<void>();
  protected readonly titleId = `modal-title-${++nextId}`;
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    // Le focus entre dans la fenêtre : premier champ s'il y en a un, sinon la fenêtre elle-même.
    afterNextRender(() => {
      const el = this.host.nativeElement;
      (el.querySelector<HTMLElement>('.modal-body input, .modal-body select, .modal-body textarea') ?? el.querySelector<HTMLElement>('.modal'))?.focus();
    });
  }

  protected onBackdrop(event: MouseEvent): void {
    // Seul un clic sur le fond (pas dans la boîte) ferme la fenêtre.
    if ((event.target as HTMLElement).classList.contains('modal')) this.closed.emit();
    else if ((event.target as HTMLElement).classList.contains('modal-dialog')) this.closed.emit();
  }
}
