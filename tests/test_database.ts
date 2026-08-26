/**
 * The test suite owns its own MySQL database, separate from the dev one.
 *
 * Why this lives in versioned code instead of `.env.test`: an env file is local and
 * untracked, so "point it at a test database" is a step every developer has to
 * remember, and forgetting it is silent — the suite just runs against dev data.
 * Here the name is resolved and validated before `#start/env` is ever read, so
 * whatever `DB_DATABASE` a local env file carries is irrelevant for tests.
 *
 * Isolation matters beyond stray writes (those were already rolled back by the
 * per-test global transaction). A transaction does NOT isolate global constraints:
 * when the first singleton landed — the UNIQUE index on `cash_sessions.open_marker` —
 * 110 tests started failing with `Duplicate entry '1'` purely because someone had
 * left the register open in the app. That class of failure depends on the state of
 * the dev database, not on the code, and this is what removes it.
 */

const DEFAULT_TEST_DATABASE = 'padel_test'

/**
 * A test database name must be an identifier ending in `_test`. The suffix is the
 * safety rail: migrations and any future schema reset run against this name, so a
 * typo that resolved to `padel_complex` would drop the dev schema.
 */
function assertTestDatabaseName(name: string): string {
  if (!/^[A-Za-z0-9_]+_test$/.test(name)) {
    throw new Error(
      `Refusing to run the test suite against database "${name}". ` +
        `TEST_DB_DATABASE must be an identifier ending in "_test" (e.g. "${DEFAULT_TEST_DATABASE}").`
    )
  }
  return name
}

/**
 * Resolved at import time from the shell environment only — `.env` files have not
 * been loaded yet when `bin/test.ts` needs this value.
 */
export const TEST_DATABASE = assertTestDatabaseName(
  process.env.TEST_DB_DATABASE ?? DEFAULT_TEST_DATABASE
)

/**
 * Creates the test database when it is missing, so a fresh clone can run `npm run test`
 * without a manual setup step. Connects without selecting a database, because Lucid
 * cannot create the database it is configured to connect to.
 */
export async function ensureTestDatabase(): Promise<void> {
  const { default: env } = await import('#start/env')
  const { createConnection } = await import('mysql2/promise')

  const connection = await createConnection({
    host: env.get('DB_HOST'),
    port: env.get('DB_PORT'),
    user: env.get('DB_USER'),
    password: env.get('DB_PASSWORD'),
  })

  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${TEST_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    )
  } finally {
    await connection.end()
  }
}
