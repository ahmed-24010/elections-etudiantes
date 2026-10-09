import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { translocoTesting } from '../testing';
import { AdminLayout } from './admin/admin-layout';
import { PublicLayout } from './public/public-layout';
import { StudentLayout } from './student/student-layout';

describe('Layouts vides', () => {
  for (const [name, cmp] of [['public', PublicLayout], ['étudiant', StudentLayout], ['admin', AdminLayout]] as const) {
    it(`le layout ${name} affiche le titre et le sélecteur de langue`, () => {
      TestBed.configureTestingModule({ imports: [cmp, translocoTesting()], providers: [provideRouter([])] });
      const fixture = TestBed.createComponent(cmp);
      fixture.detectChanges();
      const el = fixture.nativeElement as HTMLElement;
      expect(el.querySelector('.navbar-brand')?.textContent).toContain('Élections étudiantes');
      expect(el.querySelectorAll('app-language-switcher button').length).toBe(2);
    });
  }
});
