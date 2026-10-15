import { Component, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * Sélecteur de fichier : remplace le bouton natif du navigateur, dont le texte (« Choose file ») suit la langue du
 * navigateur et non celle de l'interface. Le champ natif reste dans le DOM (masqué visuellement, accessible au clavier) ;
 * le libellé est un bouton traduit de 44 px (D-37) qui l'ouvre.
 */
@Component({
  selector: 'app-file-picker',
  imports: [TranslocoPipe],
  template: `
    <div class="app-file-picker">
      <input class="app-file-input" type="file" [id]="inputId()" [accept]="accept()" [disabled]="disabled()" (change)="onChange($event)" />
      <label class="btn btn-outline-primary app-file-button" [class.disabled]="disabled()" [for]="inputId()">{{ 'common.chooseFile' | transloco }}</label>
      @if (showName()) {
        <span class="app-file-name">{{ name() ?? ('common.noFile' | transloco) }}</span>
      }
    </div>
  `,
})
export class FilePicker {
  readonly inputId = input.required<string>();
  readonly accept = input('');
  readonly disabled = input(false);
  /** Affiche le nom du fichier choisi (sinon « Aucun fichier choisi »). Faux pour un envoi immédiat. */
  readonly showName = input(true);
  readonly picked = output<File | null>();
  protected readonly name = signal<string | null>(null);

  protected onChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.name.set(this.showName() ? (file?.name ?? null) : null);
    this.picked.emit(file);
    // Même fichier choisi deux fois de suite : le navigateur doit quand même déclencher `change`.
    if (!this.showName()) input.value = '';
  }
}
