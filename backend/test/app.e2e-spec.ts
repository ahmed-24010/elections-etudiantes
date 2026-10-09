import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/prisma/prisma.service';

// Prisma est remplacé par un faux : ce test vérifie la chaîne HTTP, pas la base.
describe('App (e2e, sans base de données)', () => {
  let app: INestApplication;
  const prisma = { $queryRaw: jest.fn() };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });
  afterAll(() => app.close());

  it('GET /api/v1/health → 200 quand la base répond', async () => {
    prisma.$queryRaw.mockResolvedValue([{ 1: 1 }]);
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toEqual({ api: 'ok', database: 'ok' });
  });

  it('GET /api/v1/health → 503 quand la base est injoignable', async () => {
    prisma.$queryRaw.mockRejectedValue(new Error('down'));
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(503);
    expect(res.body.database).toBe('down');
  });

  it('renvoie un x-request-id', async () => {
    prisma.$queryRaw.mockResolvedValue([]);
    const res = await request(app.getHttpServer()).get('/api/v1/health').set('x-request-id', 'abc-123');
    expect(res.headers['x-request-id']).toBe('abc-123');
  });

  it('ancienne route /api/health → 404', () => request(app.getHttpServer()).get('/api/health').expect(404));

  it('erreur 404 au format uniforme', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/nope').expect(404);
    expect(res.body).toEqual(expect.objectContaining({ statusCode: 404, path: '/api/v1/nope' }));
  });
});
