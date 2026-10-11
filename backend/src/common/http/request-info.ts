import type { Request } from 'express';
import type { RequestInfo } from '../../auth/auth.service';

/** IP, user-agent et identifiant de requête, pour l'audit. */
export const requestInfo = (req: Request): RequestInfo => ({
  ip: req.ip,
  userAgent: req.headers['user-agent'],
  requestId: String((req as { id?: unknown }).id ?? ''),
});
