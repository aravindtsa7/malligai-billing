import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../core/database/prisma.js';
import { env } from '../../core/config/env.js';
import { UnauthorizedError } from '../../core/errors/app-error.js';
import type { LoginInput } from './auth.schema.js';
import type { JwtAuthPayload, SanitizedUser } from './auth.types.js';

export interface LoginResult {
  token: string;
  user: SanitizedUser;
}

export class AuthService {
  async login(input: LoginInput): Promise<LoginResult> {
    const user = await prisma.user.findUnique({
      where: {
        username: input.username,
      },
    });

    if (!user) {
      throw new UnauthorizedError('Invalid username or password');
    }

    const isPasswordValid = await bcrypt.compare(input.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedError('Invalid username or password');
    }

    if (!user.active) {
      throw new UnauthorizedError('Account is inactive');
    }

    const payload: JwtAuthPayload = {
      userId: user.id,
      role: user.role,
    };

    const signOptions: jwt.SignOptions = {
      expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    };

    const token = jwt.sign(payload, env.JWT_SECRET, signOptions);

    const sanitizedUser: SanitizedUser = {
      id: user.id,
      username: user.username,
      role: user.role,
      active: user.active,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    return {
      token,
      user: sanitizedUser,
    };
  }

  async getCurrentUser(userId: number): Promise<SanitizedUser> {
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
    });

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    if (!user.active) {
      throw new UnauthorizedError('Account is inactive');
    }

    return {
      id: user.id,
      username: user.username,
      role: user.role,
      active: user.active,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}

export const authService = new AuthService();

