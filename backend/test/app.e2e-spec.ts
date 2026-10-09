import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

// Prisma est remplacé par un faux : ce test vérifie la chaîne HTTP (guards, validation, erreurs), pas la base.
describe('App (e2e, sans base de données)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({ user: { findUnique: jest.fn().mockResolvedValue(null) } })
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });
  afterAll(() => app.close());

  it('GET /api/health est public', () => request(app.getHttpServer()).get('/api/health').expect(200));
  it('GET /api/me sans jeton → 401', () => request(app.getHttpServer()).get('/api/me').expect(401));
  it('GET /api/admin/ping avec jeton bidon → 401', () =>
    request(app.getHttpServer()).get('/api/admin/ping').set('Authorization', 'Bearer nope').expect(401));
  it('POST /api/auth/login invalide → 400', () =>
    request(app.getHttpServer()).post('/api/auth/login').send({ email: 'x' }).expect(400));
  it('POST /api/auth/login inconnu → 401 générique', () =>
    request(app.getHttpServer()).post('/api/auth/login').send({ email: 'a@x.tn', password: 'password123' }).expect(401));
});
