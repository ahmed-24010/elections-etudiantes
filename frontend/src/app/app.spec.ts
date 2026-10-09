import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

describe('App', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [App], providers: [provideRouter([]), provideHttpClient()] }));

  it('affiche le titre et le lien de connexion quand non authentifié', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const text = (fixture.nativeElement as HTMLElement).textContent;
    expect(text).toContain('Élections étudiantes');
    expect(text).toContain('Connexion');
  });
});
