import type { Role } from "../../shared/types.d.ts";

// Every role a user can have. New users get USER.
export const USER = "user" satisfies Role;
export const ADMIN = "admin" satisfies Role;
export const MANAGER = "manager" satisfies Role;

export const ALL_ROLES: Role[] = [USER, ADMIN, MANAGER];
