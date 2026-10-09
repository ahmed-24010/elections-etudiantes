import { HealthService } from './health.service';

describe('HealthService', () => {
  it('signale la base comme ok quand SELECT 1 réussit', async () => {
    const prisma: any = { $queryRaw: jest.fn().mockResolvedValue([{ 1: 1 }]) };
    await expect(new HealthService(prisma).check()).resolves.toEqual({ api: 'ok', database: 'ok' });
  });

  it('signale la base comme down quand la requête échoue (sans lever d’exception)', async () => {
    const prisma: any = { $queryRaw: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    await expect(new HealthService(prisma).check()).resolves.toEqual({ api: 'ok', database: 'down' });
  });
});
