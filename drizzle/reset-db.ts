import "@dotenvx/dotenvx/config";
import { error, log } from "console";
import postgres from "postgres";

// Connect to 'postgres' database instead of your app database
const connectionString = process.env.DATABASE_URL.replace(
  /\/[^/]+$/,
  "/postgres"
);
const sql = postgres(connectionString, { onnotice: () => {} });

try {
  const dbName = process.env.DATABASE_URL.split("/").pop()!;

  // Terminate all connections to the database
  await sql`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = ${dbName}
    AND pid <> pg_backend_pid()
  `;

  // Drop the database if it exists
  await sql`DROP DATABASE IF EXISTS ${sql(dbName)}`;

  // Create a new database
  await sql`CREATE DATABASE ${sql(dbName)}`;

  log(`Database ${dbName} has been reset successfully.`);
} catch (err) {
  error("Error resetting database:", err);
} finally {
  await sql.end();
  
}
