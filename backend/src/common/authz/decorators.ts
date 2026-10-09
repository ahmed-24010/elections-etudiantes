import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthUser } from './auth-user';
import type { Permission } from './permissions';

export const IS_PUBLIC = 'authz:public';
export const PERMISSIONS_KEY = 'authz:permissions';
export const SCOPE_KEY = 'authz:scope';
export const ALLOW_SETUP_TOKEN = 'authz:allow-setup-token';

/** Route sans authentification. À utiliser avec parcimonie : le coverage test les liste. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Une ou plusieurs permissions (au moins une suffit). Refus par défaut sans ce décorateur. */
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);

export type ScopeKind = 'institution' | 'election' | 'user';
export interface ScopeSpec {
  kind: ScopeKind;
  param: string;
}
/** La portée (institution, élection) est lue en base depuis la ressource désignée par ce paramètre de route. */
export const ScopeFrom = (kind: ScopeKind, param: string) => SetMetadata(SCOPE_KEY, { kind, param } satisfies ScopeSpec);

/** Autorise aussi le jeton de configuration 2FA (D-15), qui n'ouvre rien d'autre. */
export const AllowSetupToken = () => SetMetadata(ALLOW_SETUP_TOKEN, true);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
