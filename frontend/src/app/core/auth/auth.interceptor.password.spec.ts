import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { apiErrorKey } from './api-error';
import { HttpErrorResponse } from '@angular/common/http';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

// D-30 : un 401 « INVALID_PASSWORD » (mot de passe ressaisi pour voter) n'est pas une session expirée. S'il était rejoué après
// un renouvellement de jeton, le vote serait envoyé deux fois et compterait deux échecs dans le blocage du compte.
describe('authInterceptor : mot de passe de vote refusé', () => {
  afterEach(() => {
    TestBed.inject(HttpTestingController).verify();
    TestBed.resetTestingModule();
  });

  it('transmet le 401 INVALID_PASSWORD tel quel : ni renouvellement de jeton, ni nouvel envoi du vote', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting()] });
    TestBed.inject(AuthService).user.set({ id: 'u1', email: null, phone: null, twoFactorEnabled: false, roles: [] });
    const http = TestBed.inject(HttpClient);
    const ctrl = TestBed.inject(HttpTestingController);
    let error: HttpErrorResponse | undefined;
    http.post('/api/v1/voting/e1/ballot', { choices: [], password: 'faux' }).subscribe({ error: (e) => (error = e) });
    ctrl.expectOne('/api/v1/voting/e1/ballot').flush({ message: 'INVALID_PASSWORD' }, { status: 401, statusText: 'Unauthorized' });
    expect(error?.status).toBe(401);
    ctrl.expectNone('/api/v1/auth/refresh');
    ctrl.expectNone('/api/v1/voting/e1/ballot');
  });
});

describe('apiErrorKey : vote', () => {
  const err = (status: number, message: string) => new HttpErrorResponse({ status, error: { message } });

  it('associe chaque code du serveur à sa clé', () => {
    expect(apiErrorKey(err(401, 'INVALID_PASSWORD'))).toBe('errors.invalidPassword');
    expect(apiErrorKey(err(429, 'ACCOUNT_LOCKED'))).toBe('errors.voteLocked');
    expect(apiErrorKey(err(429, 'ThrottlerException: Too Many Requests'))).toBe('errors.tooMany');
    expect(apiErrorKey(err(409, 'ELECTION_NOT_OPEN'))).toBe('errors.electionNotOpen');
    expect(apiErrorKey(err(403, 'NOT_ON_VOTER_ROLL'))).toBe('errors.notOnVoterRoll');
    expect(apiErrorKey(err(409, 'ALREADY_VOTED'))).toBe('errors.alreadyVoted');
    expect(apiErrorKey(err(422, 'INVALID_BALLOT'))).toBe('errors.invalidBallot');
  });
});
