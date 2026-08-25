import type { Role } from '../../generated/prisma/enums.js';

export interface AuthenticatedUser {
  id: number;
  username: string;
  role: Role;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface JwtAuthPayload {
  userId: number;
  role: Role;
}

export type SanitizedUser = Omit<AuthenticatedUser, never>;

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

