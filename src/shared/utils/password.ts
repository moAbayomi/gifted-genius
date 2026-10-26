import argon2 from "argon2";
import crypto from "crypto";

export function newToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(
  hash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

const DUMMY_HASH =
  "$argon2id$v=19$m=65536,p=4,t=3$sv/qw2MBT748oInLTNbIiA$rSz0L1VRIkvWrs8GY1ONnJBEkIPIuoYMZQopdnaxJ2Q";

export function getDummyHash(): string {
  return DUMMY_HASH;
}
