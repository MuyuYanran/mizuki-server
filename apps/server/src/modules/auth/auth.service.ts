/**
 * [阶段 P6] auth/auth.service — 认证核心与一次性初始化
 * [职责] argon2id 密码哈希与校验、jose HS256 双 Token（access 15m / refresh 7d，
 *   轮换刷新）、登录失败计数与锁定（5 次 → 锁 15 分钟）、一次性初始化
 *   （detector 校验 → 创建管理员 → 更新 config.json）。
 * [状态] ACTIVE
 *
 * JWT secret 策略（P6 §3.1，取舍见交付报告疑问清单 / ADR-005）：
 *   优先环境变量 MIZUKI_JWT_SECRET；缺失时 init 生成强随机密钥并持久化到
 *   config.json（jwtSecret 可选字段），重启后 refresh token 仍有效。
 * 安全纪律：密码 / secret / token 一律不落日志（P6 §5）。
 */
import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { logger } from '../../common/logger';
import type { AccessTokenVerifier, AuthenticatedUser } from '../../common/guards/jwt-auth.guard';
import { getAppConfig, mergeAndPersistConfig, resetAppConfigCache } from '../../config/app-config';
import { type DrizzleDb, DRIZZLE_DB } from '../../infra/db/db.module';
import { adminUser } from '../../infra/db/schema';
import { MizukiDetectorService } from '../system/mizuki-detector.service';

// ── zod schema（全部输入边界） ──

/** POST /admin/auth/login body */
export const LoginBodySchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

/** POST /admin/auth/refresh body */
export const RefreshBodySchema = z.object({
  refreshToken: z.string().min(1),
});

export type LoginBodyType = z.infer<typeof LoginBodySchema>;
export type RefreshBodyType = z.infer<typeof RefreshBodySchema>;

/** POST /system/init body（REQUIREMENTS §7 第 1 条；密码最短 8 位为安全基线，见交付报告） */
export const InitBodySchema = z.object({
  mizukiRoot: z.string().min(1),
  mode: z.enum(['manage', 'additive', 'overwrite']),
  username: z.string().min(1).max(64),
  password: z.string().min(8).max(200),
});

export type InitBody = z.infer<typeof InitBodySchema>;

/** PATCH /admin/auth/password body（[B2/裁决 5] 强度基线同注册：最短 8 位） */
export const ChangePasswordBodySchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

export type ChangePasswordBody = z.infer<typeof ChangePasswordBodySchema>;

/** access / refresh 时效（P6 §3.1 默认值） */
const ACCESS_TTL = '15m';
const REFRESH_TTL = '7d';

/** 失败锁定参数（P6 §3.3）：连续 5 次失败 → 锁定 15 分钟 */
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

/** token 类型 claim */
type TokenType = 'access' | 'refresh';

@Injectable()
export class AuthService implements AccessTokenVerifier {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: DrizzleDb,
    private readonly detector: MizukiDetectorService,
  ) {}

  // ── 初始化 ──

  /** 是否已初始化（admin_user 存在行） */
  async isInitialized(): Promise<boolean> {
    const rows = await this.db
      .select({ total: sql<number>`count(*)` })
      .from(adminUser);
    return (rows[0]?.total ?? 0) > 0;
  }

  /**
   * 一次性初始化（P6 §3.4）：已有管理员 → 409；
   * mizukiRoot 经 detector 检测，无效 → 400 附检查明细；
   * 有效 → 创建管理员（argon2id）+ 更新 config.json（mizukiRoot/mode/jwtSecret）。
   */
  async initialize(body: InitBody): Promise<{ initialized: true }> {
    if (await this.isInitialized()) {
      throw new ConflictException('系统已初始化（初始化仅可执行一次）');
    }
    const detection = this.detector.detect(body.mizukiRoot);
    if (!detection.valid) {
      throw new BadRequestException({
        message: 'Mizuki 项目检测未通过',
        detail: { checks: detection.checks },
      });
    }

    // config.json 更新：env 已提供 secret 时不覆盖生成（env 优先，见 getJwtSecret）
    const patch: Record<string, unknown> = { mizukiRoot: body.mizukiRoot, mode: body.mode };
    if (!process.env['MIZUKI_JWT_SECRET']) {
      patch['jwtSecret'] = randomBytes(48).toString('base64url');
    }
    mergeAndPersistConfig(patch);
    resetAppConfigCache();

    const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });
    await this.db.insert(adminUser).values({
      id: nanoid(),
      username: body.username,
      passwordHash,
      createdAt: new Date(),
    });
    logger.info({ username: body.username, mode: body.mode }, '初始化完成（管理员已创建）');
    return { initialized: true };
  }

  // ── 登录 / 刷新 / 校验 ──

  /** 登录：失败计数与锁定（§3.3）；成功清零计数并更新 last_login_at */
  async login(username: string, password: string): Promise<{ accessToken: string; refreshToken: string }> {
    const rows = await this.db.select().from(adminUser).where(eq(adminUser.username, username));
    const user = rows[0];
    if (!user) {
      // 用户不存在时也执行一次等价哈希校验（恒定时间行为，不泄露用户名存在性）
      await argon2.verify(await dummyHashTarget(), password).catch(() => false);
      logger.warn({ username }, '登录失败：用户不存在');
      throw new UnauthorizedException('用户名或密码错误');
    }
    if (user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now()) {
      logger.warn({ username }, '登录拒绝：账户处于锁定期');
      throw new HttpException('账户因连续登录失败已被锁定，请 15 分钟后重试', HttpStatus.LOCKED);
    }

    const valid = await argon2.verify(user.passwordHash, password);
    if (!valid) {
      const failed = user.failedLoginCount + 1;
      if (failed >= MAX_FAILED_ATTEMPTS) {
        await this.db
          .update(adminUser)
          .set({ failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCK_DURATION_MS) })
          .where(eq(adminUser.id, user.id));
        logger.warn({ username }, '登录失败次数达到上限，账户已锁定 15 分钟');
      } else {
        await this.db
          .update(adminUser)
          .set({ failedLoginCount: failed })
          .where(eq(adminUser.id, user.id));
        logger.warn({ username, failed }, '登录失败：密码错误');
      }
      throw new UnauthorizedException('用户名或密码错误');
    }

    await this.db
      .update(adminUser)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(adminUser.id, user.id));
    logger.info({ username }, '登录成功');
    return this.issueTokenPair({ id: user.id, username: user.username }, user.tokenVersion);
  }

  /**
   * 刷新：校验 refresh token → 签发新的一对（轮换）。
   * [B2/裁决 5] refresh token 内 ver 与表内 token_version 比对，不一致 → 401
   * （改密吊销语义；access 15min 自然过期，不做吊销）。
   */
  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const payload = await this.verifyToken(refreshToken, 'refresh');
    const rows = await this.db.select().from(adminUser).where(eq(adminUser.id, payload.sub));
    const user = rows[0];
    if (!user) {
      throw new UnauthorizedException('refresh token 对应的用户不存在');
    }
    if (payload.ver !== user.tokenVersion) {
      logger.info({ userId: user.id }, 'refresh 拒绝：token 版本过期（密码已修改或会话已吊销）');
      throw new UnauthorizedException('会话已失效，请重新登录');
    }
    return this.issueTokenPair({ id: user.id, username: user.username }, user.tokenVersion);
  }

  /**
   * [B2/裁决 5] 修改密码：旧密码 argon2id verify → 新密码哈希落库 +
   * token_version +1（吊销全部既有 refresh token；access 15min 自然过期）。
   */
  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<{ passwordChanged: true }> {
    const rows = await this.db.select().from(adminUser).where(eq(adminUser.id, userId));
    const user = rows[0];
    if (!user) {
      throw new UnauthorizedException('认证凭据对应的用户不存在');
    }
    const valid = await argon2.verify(user.passwordHash, oldPassword);
    if (!valid) {
      logger.warn({ userId }, '修改密码拒绝：旧密码不正确');
      throw new BadRequestException('旧密码不正确');
    }
    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.db
      .update(adminUser)
      .set({ passwordHash, tokenVersion: user.tokenVersion + 1 })
      .where(eq(adminUser.id, user.id));
    logger.info({ userId }, '密码已修改，token_version 已递增（全部 refresh 会话吊销）');
    return { passwordChanged: true };
  }

  /** access token 校验（守卫调用）：签名/时效/类型 claim 全通过才返回用户 */
  async verifyAccessToken(token: string): Promise<AuthenticatedUser> {
    const payload = await this.verifyToken(token, 'access');
    const rows = await this.db.select().from(adminUser).where(eq(adminUser.id, payload.sub));
    const user = rows[0];
    if (!user) {
      throw new UnauthorizedException('认证凭据对应的用户不存在');
    }
    return { id: user.id, username: user.username };
  }

  /** 当前管理员信息（GET /admin/auth/me） */
  async me(userId: string): Promise<{ id: string; username: string; createdAt: string; lastLoginAt: string | null }> {
    const rows = await this.db.select().from(adminUser).where(eq(adminUser.id, userId));
    const user = rows[0];
    if (!user) {
      throw new UnauthorizedException('认证凭据对应的用户不存在');
    }
    return {
      id: user.id,
      username: user.username,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt === null ? null : user.lastLoginAt.toISOString(),
    };
  }

  // ── 内部实现 ──

  /**
   * 签发双 Token（claims：sub / username / type / ver / jti / iat / exp）。
   * [B2/裁决 5] ver = 签发时的 token_version：refresh 校验比对，access 不校验
   * （15min 自然过期，不做吊销）。
   */
  private async issueTokenPair(admin: { id: string; username: string }, tokenVersion: number): Promise<{ accessToken: string; refreshToken: string }> {
    return {
      accessToken: await this.signToken(admin, 'access', ACCESS_TTL, tokenVersion),
      refreshToken: await this.signToken(admin, 'refresh', REFRESH_TTL, tokenVersion),
    };
  }

  private async signToken(admin: { id: string; username: string }, type: TokenType, ttl: string, ver: number): Promise<string> {
    return new SignJWT({ username: admin.username, type, ver })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(admin.id)
      .setJti(nanoid())
      .setIssuedAt()
      // jose v6：setExpirationTime 接受相对时间串（'15m' / '7d'）
      .setExpirationTime(ttl)
      .sign(secretKey(this.getJwtSecret()));
  }

  /** 校验签名/时效与 type claim，返回 payload（sub 必为字符串；ver 为可选数值） */
  private async verifyToken(token: string, expectedType: TokenType): Promise<{ sub: string; ver: number | undefined }> {
    let payload: { sub?: string; type?: unknown; ver?: unknown };
    try {
      const verified = await jwtVerify(token, secretKey(this.getJwtSecret()));
      payload = verified.payload as { sub?: string; type?: unknown; ver?: unknown };
    } catch {
      throw new UnauthorizedException('认证凭据无效或已过期');
    }
    if (payload['type'] !== expectedType) {
      throw new UnauthorizedException('认证凭据类型不符');
    }
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      throw new UnauthorizedException('认证凭据缺少主体声明');
    }
    // ver 仅由本服务签发（number）；缺失/非法按 undefined 处理，由调用方决定是否比对
    const ver = typeof payload['ver'] === 'number' ? payload['ver'] : undefined;
    return { sub: payload.sub, ver };
  }

  /**
   * JWT secret 解析（P6 §3.1）：
   * 1. 环境变量 MIZUKI_JWT_SECRET 优先（部署注入通道）；
   * 2. config.json 的 jwtSecret（init 时生成并持久化，重启后仍有效）；
   * 3. 兜底：生成强随机密钥并持久化（不应发生——init 先于任何登录）。
   */
  private getJwtSecret(): string {
    const fromEnv = process.env['MIZUKI_JWT_SECRET'];
    if (fromEnv && fromEnv.length > 0) {
      return fromEnv;
    }
    const configured = getAppConfig().jwtSecret;
    if (configured && configured.length > 0) {
      return configured;
    }
    const generated = randomBytes(48).toString('base64url');
    mergeAndPersistConfig({ jwtSecret: generated });
    resetAppConfigCache();
    return generated;
  }
}

// ── 纯工具 ──

/** jose 密钥编码（HS256 对称密钥） */
function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/**
 * 定时攻击缓解的哑元哈希目标（懒计算一次）：
 * 用户不存在时也执行一次真实成本的 argon2 校验，使响应时间不可区分。
 */
let dummyHashPromise: Promise<string> | undefined;
function dummyHashTarget(): Promise<string> {
  dummyHashPromise ??= argon2.hash('mizuki-dummy-password', { type: argon2.argon2id });
  return dummyHashPromise;
}
