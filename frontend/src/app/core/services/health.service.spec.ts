import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../../environments/environment';
import { HealthService } from './health.service';

describe('HealthService', () => {
  let http: HttpTestingController;
  let service: HealthService;
  const url = `${environment.apiUrl}/health`;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(HealthService);
  });
  afterEach(() => http.verify());

  it('renvoie l etat quand tout va bien', () => {
    let res: unknown;
    service.status().subscribe((r) => (res = r));
    http.expectOne(url).flush({ api: 'ok', database: 'ok' });
    expect(res).toEqual({ api: 'ok', database: 'ok' });
  });

  it('conserve l etat sur un 503 (base indisponible)', () => {
    let res: unknown;
    service.status().subscribe((r) => (res = r));
    http.expectOne(url).flush({ api: 'ok', database: 'down' }, { status: 503, statusText: 'Service Unavailable' });
    expect(res).toEqual({ api: 'ok', database: 'down' });
  });

  it('renvoie null quand le serveur est injoignable', () => {
    let res: unknown = 'init';
    service.status().subscribe((r) => (res = r));
    http.expectOne(url).error(new ProgressEvent('error'));
    expect(res).toBeNull();
  });
});
