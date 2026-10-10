import { Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

@Component({
  selector: 'app-footer',
  imports: [TranslocoPipe],
  template: `
    <footer class="app-footer">
      <div class="container">{{ 'institution.faculty' | transloco }} · {{ 'institution.university' | transloco }}</div>
    </footer>
  `,
})
export class AppFooter {}
