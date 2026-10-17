import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { conflict, unauthorized } from '../../errors';
import type { Config } from '../../config';
import type { Database } from '../../db';
import type { EventBus } from '../../events';
import { users, refreshTokens } from '../../schema';

const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
const UNIQUE_VIOLATION = '23505';

export interface User {
  id: number;
  email: string;
}

export interface TokenResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthService {
  register(email: string, password: string): Promise<TokenResponse>;
  login(email: string, password: string): Promise<TokenResponse>;
  refresh(refreshToken: string): Promise<TokenResponse>;
  logout(refreshToken: string): Promise<void>;
}

interface AuthServiceOptions {
  db: Database;
  config: Config;
  bus: EventBus;
}

export function createAuthService({ db, config, bus }: AuthServiceOptions): AuthService {
  async function issueTokens(userId: number): Promise<Omit<TokenResponse, 'user'>> {
    const accessToken = jwt.sign({ sub: String(userId) }, config.JWT_SECRET, {
      algorithm: 'HS256',
      expiresIn: config.ACCESS_TTL_SECONDS,
    });
    const refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + config.REFRESH_TTL_DAYS * 86_400_000);
    await db.insert(refreshTokens).values({
      userId,
      tokenHash: sha256(refreshToken),
      expiresAt,
    });
    return { accessToken, refreshToken, expiresIn: config.ACCESS_TTL_SECONDS };
  }

  return {
    async register(email: string, password: string): Promise<TokenResponse> {
      const hash = await bcrypt.hash(password, 10);
      let userId: number;
      try {
        const result = await db
          .insert(users)
          .values({
            email,
            passwordHash: hash,
          })
          .returning({ id: users.id });
        userId = Number(result[0]!.id);
      } catch (err) {
        if ((err as Record<string, string>).code === UNIQUE_VIOLATION) {
          throw conflict('Email already registered', 'EMAIL_TAKEN');
        }
        throw err;
      }
      bus.emit('user.registered', { userId });
      return { user: { id: userId, email }, ...(await issueTokens(userId)) };
    },

    async login(email: string, password: string): Promise<TokenResponse> {
      const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
      const user = result[0];
      const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !ok) throw unauthorized('Invalid email or password');
      const userId = Number(user.id);
      bus.emit('user.login', { userId });
      return { user: { id: userId, email: user.email }, ...(await issueTokens(userId)) };
    },

    async refresh(refreshToken: string): Promise<TokenResponse> {
      const tokenHash = sha256(refreshToken);
      const result = await db
        .update(refreshTokens)
        .set({ revoked: true })
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .returning({ userId: refreshTokens.userId });

      if (result.length > 0) {
        const userId = Number(result[0]!.userId);
        const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        return { user: { id: userId, email: user[0]!.email }, ...(await issueTokens(userId)) };
      }

      const token = await db
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .limit(1);

      if (token[0]?.revoked) {
        await db
          .update(refreshTokens)
          .set({ revoked: true })
          .where(eq(refreshTokens.userId, token[0].userId));
        throw unauthorized('Refresh token reuse detected');
      }
      throw unauthorized(token[0] ? 'Refresh token expired' : 'Invalid refresh token');
    },

    async logout(refreshToken: string): Promise<void> {
      await db
        .update(refreshTokens)
        .set({ revoked: true })
        .where(eq(refreshTokens.tokenHash, sha256(refreshToken)));
    },
  };
}
