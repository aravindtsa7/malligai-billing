import type { Role } from '../../generated/prisma/enums.js';

export interface SanitizedUser {
  id: number;
  username: string;
  role: Role;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface UserListResponse {
  users: SanitizedUser[];
  pagination: UserPagination;
}

export function serializeUser(user: {
  id: number;
  username: string;
  role: Role;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}): SanitizedUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    active: user.active,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

