import { Body, Controller, ForbiddenException, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { CookieOptions, Request, Response } from 'express';
import { AllowSetupToken, CurrentUser, Public, RequirePermission } from '../common/authz/decorators';
import type { AuthUser } from '../common/authz/auth-user';
import { AuthService, RequestInfo, Session } from './auth.service';
import { CodeDto, LoginDto, RegisterDto } from './dto/auth.dto';

export const REFRESH_COOKIE = 'refresh_token';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
/** En-tête personnalisé exigé sur refresh / logout : défense CSRF supplémentaire (un formulaire inter-site ne peut pas l'envoyer). */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'XMLHttpRequest';

// Limite renforcée sur /auth/* (par IP réelle : voir TRUST_PROXY dans main.ts).
@ApiTags('auth')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(202)
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    await this.auth.register(dto, this.info(req));
    // Même réponse que l'e-mail soit nouveau ou déjà connu.
    return { status: 'accepted' };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto, this.info(req));
    if (result.status !== 'authenticated') return result;
    return this.sessionBody(res, result.session);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.assertCsrfHeader(req);
    const session = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], this.info(req));
    return this.sessionBody(res, session);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.assertCsrfHeader(req);
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE], this.info(req));
    res.clearCookie(REFRESH_COOKIE, { ...this.cookieOptions(), maxAge: undefined });
  }

  /** Utilisable avec le jeton de configuration (D-15) ou avec un jeton d'accès (étudiant, 2FA optionnelle). */
  @Post('2fa/setup')
  @HttpCode(200)
  @AllowSetupToken()
  @RequirePermission('user:update:self')
  setupTwoFactor(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.auth.startTwoFactorSetup(user, this.info(req));
  }

  @Post('2fa/enable')
  @HttpCode(200)
  @AllowSetupToken()
  @RequirePermission('user:update:self')
  async enableTwoFactor(
    @CurrentUser() user: AuthUser,
    @Body() dto: CodeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.enableTwoFactor(user, dto.code, this.info(req));
    return session ? this.sessionBody(res, session) : { status: 'enabled' };
  }

  @Post('step-up')
  @HttpCode(204)
  @RequirePermission('user:update:self')
  async stepUp(@CurrentUser() user: AuthUser, @Body() dto: CodeDto, @Req() req: Request) {
    await this.auth.stepUp(user, dto.code, this.info(req));
  }

  private sessionBody(res: Response, session: Session) {
    // Le refresh token ne quitte jamais le cookie HttpOnly ; le corps ne contient que le jeton d'accès.
    res.cookie(REFRESH_COOKIE, session.refreshToken, { ...this.cookieOptions(), expires: session.refreshExpiresAt });
    return { status: 'authenticated', accessToken: session.accessToken };
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get('NODE_ENV') === 'production',
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
    };
  }

  private assertCsrfHeader(req: Request) {
    if (req.headers[CSRF_HEADER] !== CSRF_VALUE) throw new ForbiddenException('csrf_header_required');
  }

  private info(req: Request): RequestInfo {
    return { ip: req.ip, userAgent: req.headers['user-agent'], requestId: String((req as { id?: unknown }).id ?? '') };
  }
}
