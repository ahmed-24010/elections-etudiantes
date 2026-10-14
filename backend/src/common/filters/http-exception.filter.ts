import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';

/** Format d'erreur uniforme ; aucun détail interne n'est exposé pour les erreurs 5xx. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let conditions: string[] | undefined;
    if (exception instanceof HttpException && status < 500) {
      const body = exception.getResponse();
      message = typeof body === 'string' ? body : ((body as { message?: string | string[] }).message ?? exception.message);
      // 04 §4 : une transition refusée liste les conditions non remplies.
      if (typeof body === 'object') conditions = (body as { conditions?: string[] }).conditions;
    }
    if (status >= 500) this.logger.error(exception instanceof Error ? exception.stack : String(exception));

    res.status(status).json({ statusCode: status, message, ...(conditions ? { conditions } : {}), path: req.url, timestamp: new Date().toISOString() });
  }
}
