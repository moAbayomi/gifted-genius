import { API_PREFIX } from "../../src/config.js";

export function apiPath(path: string): string {
  // Only prepend if not already prefixed.
  return path.startsWith(API_PREFIX) ? path : `${API_PREFIX}${path}`;
}
