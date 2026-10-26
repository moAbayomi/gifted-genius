import {env, isProd} from "../config/env.js";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { remember } from "@epic-web/remember";


const createPool = () => {
  const pool = new Pool({
    connectionString: env.DB_URL,
  });

  pool.on("error", (err) => {
    console.error("[db] idle client error (pool stays up) ", err.message);
  });

  return pool;
};

let client;
if (isProd()) {
  client = createPool();
} else {
  client = remember("dbPool", () => createPool());
}

export const db = drizzle({ client });

export default db;
