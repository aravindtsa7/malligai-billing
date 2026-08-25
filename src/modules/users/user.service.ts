import bcrypt from 'bcryptjs';
import { prisma } from '../../core/database/prisma.js';
import { BadRequestError, NotFoundError } from '../../core/errors/app-error.js';
import { Role } from '../../generated/prisma/enums.js';
import type {
  CreateUserInput,
  UpdateUserStatusInput,
  ResetPasswordInput,
  ListUsersQueryInput,
} from './user.schema.js';
import {
  serializeUser,
  type SanitizedUser,
  type UserListResponse,
} from './user.types.js';

export class UserService {
  async createUser(input: CreateUserInput): Promise<SanitizedUser> {
    const passwordHash = await bcrypt.hash(input.password, 10);

    // Public user creation is strictly for SALESMAN role
    const user = await prisma.user.create({
      data: {
        username: input.username,
        passwordHash,
        role: Role.SALESMAN,
        active: true,
      },
    });

    return serializeUser(user);
  }

  async listUsers(query: ListUsersQueryInput): Promise<UserListResponse> {
    const { page, limit, role, active } = query;
    const skip = (page - 1) * limit;

    const where: {
      role?: Role;
      active?: boolean;
    } = {};

    if (role !== undefined) {
      where.role = role;
    }

    if (active !== undefined) {
      where.active = active;
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { id: 'asc' },
      }),
      prisma.user.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      users: users.map(serializeUser),
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  async getUserById(id: number): Promise<SanitizedUser> {
    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    return serializeUser(user);
  }

  async updateUserStatus(id: number, input: UpdateUserStatusInput): Promise<SanitizedUser> {
    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Protect ADMIN accounts from accidental status change via salesman-management endpoint
    if (user.role === Role.ADMIN) {
      throw new BadRequestError('Cannot modify status of an ADMIN account');
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        active: input.active,
      },
    });

    return serializeUser(updated);
  }

  async resetUserPassword(id: number, input: ResetPasswordInput): Promise<SanitizedUser> {
    const user = await prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Target must be a SALESMAN
    if (user.role === Role.ADMIN) {
      throw new BadRequestError('Cannot reset password of an ADMIN account via this endpoint');
    }

    const passwordHash = await bcrypt.hash(input.password, 10);

    const updated = await prisma.user.update({
      where: { id },
      data: {
        passwordHash,
      },
    });

    return serializeUser(updated);
  }
}

export const userService = new UserService();

