import { Component, ElementRef, HostListener, inject, input, signal, viewChild } from '@angular/core';

/**
 * Bouton-icône qui ouvre un petit menu (compte, langue). Le bouton porte l'icône (contenu `[icon]`), le menu le reste du
 * contenu. Accessible au clavier : Entrée / Espace ouvrent, Échap ferme et rend le focus au bouton, la tabulation hors
 * du menu le ferme ; un clic à l'extérieur ou sur un choix du menu le ferme aussi.
 */
@Component({
  selector: 'app-icon-menu',
  template: `
    <div class="app-menu" (focusout)="onFocusOut($event)">
      <button
        #toggle
        type="button"
        [class]="buttonClass()"
        aria-haspopup="true"
        [attr.aria-expanded]="open()"
        [attr.aria-label]="label()"
        (click)="open.set(!open())"
        (keydown.escape)="close(true)"
      >
        <ng-content select="[icon]" />
      </button>
      @if (open()) {
        <div class="app-menu-panel" role="presentation" (keydown.escape)="close(true)" (click)="onPanelClick($event)">
          <ng-content />
        </div>
      }
    </div>
  `,
})
export class IconMenu {
  /** Nom accessible du bouton (déjà traduit). */
  readonly label = input.required<string>();
  /** Classe du bouton : icône de la barre du haut par défaut, badge ailleurs. */
  readonly buttonClass = input('app-icon-btn');
  protected readonly open = signal(false);
  private readonly toggle = viewChild.required<ElementRef<HTMLButtonElement>>('toggle');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  close(refocus = false): void {
    this.open.set(false);
    if (refocus) this.toggle().nativeElement.focus();
  }

  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (next && !this.host.nativeElement.contains(next)) this.open.set(false);
  }

  /** Choisir un élément du menu (bouton ou lien) le referme. */
  protected onPanelClick(event: Event): void {
    if ((event.target as HTMLElement).closest('button, a')) this.open.set(false);
  }
}
