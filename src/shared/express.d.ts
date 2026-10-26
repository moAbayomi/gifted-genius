import type { User, Membership, Session } from "../../db/schema/index.js";
import type { Actor } from "../../modules/rbac/can.js";
import type { Permission } from "../../modules/rbac/permissions.js";

declare global {
  namespace Express {
    interface Request {
      
      permissions?: Set<Permission>;
      actor?: Actor;
      mustChangePassword?: boolean; // ← add this
      sessionId?: string;
    }
  }
}

export {};
