import type { CreateUserResponse } from "./client";

let pending: CreateUserResponse | null = null;

export function setPendingInvite(result: CreateUserResponse) {
  pending = result;
}

export function getPendingInvite() {
  return pending;
}

export function clearPendingInvite() {
  pending = null;
}
