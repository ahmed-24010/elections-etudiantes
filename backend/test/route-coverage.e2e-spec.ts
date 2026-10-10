import { Controller, Get, INestApplication, Post, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, ModulesContainer } from '@nestjs/core';
import { IS_PUBLIC, PERMISSIONS_KEY, Public, RequirePermission } from '../src/common/authz/decorators';
import { bearer, createTestApp } from './helpers';
import { Role } from '@prisma/client';

interface RouteInfo {
  route: string;
  public: boolean;
  permissions: string[];
}

/** Toutes les routes déclarées par les contrôleurs de l'application, avec leur décorateur d'autorisation. */
export function listRoutes(app: INestApplication): RouteInfo[] {
  const routes: RouteInfo[] = [];
  for (const wrapper of new DiscoveryService(app.get(ModulesContainer)).getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;
    const base = String(Reflect.getMetadata(PATH_METADATA, metatype) ?? '');
    for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(instance))) {
      const handler = instance[name];
      if (typeof handler !== 'function' || name === 'constructor') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, handler);
      if (method === undefined) continue; // pas une route
      const path = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
      routes.push({
        route: `${RequestMethod[method]} /${[base, path].filter(Boolean).join('/')}`.replace(/\/+/g, '/').replace(/(.)\/$/, '$1'),
        public: Boolean(Reflect.getMetadata(IS_PUBLIC, handler) ?? Reflect.getMetadata(IS_PUBLIC, metatype)),
        permissions: Reflect.getMetadata(PERMISSIONS_KEY, handler) ?? Reflect.getMetadata(PERMISSIONS_KEY, metatype) ?? [],
      });
    }
  }
  return routes;
}

export const undecorated = (routes: RouteInfo[]) => routes.filter((r) => !r.public && r.permissions.length === 0).map((r) => r.route);

// Une route sans décorateur de ce type, qui n'existerait que dans un module de test.
@Controller('naked')
class NakedController {
  @Get('forgotten')
  forgotten() {
    return 'oublié';
  }

  @Post('declared')
  @RequirePermission('user:update:self')
  declared() {
    return 'ok';
  }

  @Get('open')
  @Public()
  open() {
    return 'ok';
  }
}

describe('Couverture des routes (03 §8 n°10) : chaque route porte @RequirePermission ou @Public', () => {
  it('toutes les routes de l’application sont décorées — sinon la CI est rouge', async () => {
    const t = await createTestApp();
    try {
      const routes = listRoutes(t.app);
      expect(routes.length).toBeGreaterThan(10); // garde-fou : la découverte trouve bien les routes
      expect(undecorated(routes)).toEqual([]);
    } finally {
      await t.app.close();
    }
  });

  it('le test échoue bien quand une route est oubliée (preuve que la CI serait rouge)', async () => {
    const t = await createTestApp({ controllers: [NakedController] });
    try {
      expect(undecorated(listRoutes(t.app))).toEqual(['GET /naked/forgotten']);
    } finally {
      await t.app.close();
    }
  });

  it('à l’exécution, une route oubliée est refusée par défaut (jamais ouverte)', async () => {
    const t = await createTestApp({ controllers: [NakedController] });
    try {
      await t.api('get', '/naked/forgotten').expect(401);
      const u = await t.world.addUser('anyone@example.test', [{ role: Role.SUPER_ADMIN }]);
      const { token } = await t.world.session(u.id);
      await t.api('get', '/naked/forgotten').set('authorization', bearer(token)).expect(403);
      await t.api('get', '/naked/open').expect(200);
    } finally {
      await t.app.close();
    }
  });

  it('la liste des routes publiques est figée : en ajouter une doit être un choix relu en revue', async () => {
    const t = await createTestApp();
    try {
      const publics = listRoutes(t.app).filter((r) => r.public).map((r) => r.route).sort();
      expect(publics).toEqual([
        'GET /files/:fileId', // authentifiée par la SIGNATURE de l'URL (5 min), pas par un en-tête
        'GET /health',
        'GET /institutions/public',
        'POST /auth/login',
        'POST /auth/logout',
        'POST /auth/refresh',
        'POST /auth/register',
      ]);
    } finally {
      await t.app.close();
    }
  });
});
