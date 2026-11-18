// src/types/custom-env.d.ts
//
// Type declarations for the untyped `custom-env` package. The library ships
// no types and no @types/custom-env exists on npm. Only `env()` is used
// in this project — add more signatures here if additional exports are used.
declare module "custom-env" {
  interface EnvOptions {
    envName?: string;
    path?: string;
    encoding?: BufferEncoding;
    defaultEnvName?: string;
    verbose?: boolean;
  }

  /** Load variables from `.env.{envName}` into `process.env`. */
  export function env(envName?: string, path?: string): void;
  export function env(envName?: string, options?: EnvOptions): void;

  /** Parse a string of env-var text into an object. */
  export function parse(data: string): Record<string, string>;

  /** Serialize an object into env-var text. */
  export function stringify(obj: Record<string, unknown>): string;
}