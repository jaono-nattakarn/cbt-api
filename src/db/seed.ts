import "dotenv/config";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { databaseUrl, runDatabaseSetup } from "./setup";

interface SeedUser {
  email: string;
  name: string;
  role: "admin" | "supervisor" | "therapist" | "viewer";
  affiliation: string;
}

const DEV_PASSWORD = process.env.SEED_DEV_PASSWORD || "demo1234";
const ORGANIZATION_NAME = process.env.SEED_ORGANIZATION_NAME || "CBT Lab";
const ORGANIZATION_SLUG = process.env.SEED_ORGANIZATION_SLUG || "cbt-lab";

const USERS: SeedUser[] = [
  {
    email: process.env.SEED_SUPERVISOR_EMAIL || "supervisor@thera.app",
    name: process.env.SEED_SUPERVISOR_NAME || "Dr. Wattana",
    role: "supervisor",
    affiliation: ORGANIZATION_NAME,
  },
  {
    email: process.env.SEED_THERAPIST_EMAIL || "therapist@thera.app",
    name: process.env.SEED_THERAPIST_NAME || "Dr. Saran",
    role: "therapist",
    affiliation: ORGANIZATION_NAME,
  },
];

async function upsertOrganization(pool: Pool): Promise<number> {
  const result = await pool.query<{ id: number }>(
    `
      insert into organizations (name, slug, status, settings)
      values ($1, $2, 'active', '{}'::jsonb)
      on conflict (slug) do update set
        name = excluded.name,
        status = 'active',
        updated_at = now()
      returning id
    `,
    [ORGANIZATION_NAME, ORGANIZATION_SLUG],
  );
  return result.rows[0].id;
}

async function upsertUser(pool: Pool, organizationId: number, user: SeedUser, passwordHash: string) {
  const existing = await pool.query<{ id: number }>(
    `
      select id
      from users
      where organization_id = $1
        and lower(email) = lower($2)
        and deleted_at is null
      limit 1
    `,
    [organizationId, user.email],
  );

  if (existing.rows[0]) {
    await pool.query(
      `
        update users
        set display_name = $2,
          password_hash = $3,
          role = $4,
          status = 'active',
          affiliation = $5,
          updated_at = now()
        where id = $1
      `,
      [existing.rows[0].id, user.name, passwordHash, user.role, user.affiliation],
    );
    return;
  }

  await pool.query(
    `
      insert into users (
        organization_id,
        email,
        password_hash,
        display_name,
        role,
        status,
        affiliation
      )
      values ($1, lower($2), $3, $4, $5, 'active', $6)
    `,
    [organizationId, user.email, passwordHash, user.name, user.role, user.affiliation],
  );
}

async function seedDevData() {
  await runDatabaseSetup();

  const pool = new Pool({ connectionString: databaseUrl() });
  try {
    const organizationId = await upsertOrganization(pool);
    const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);

    for (const user of USERS) {
      await upsertUser(pool, organizationId, user, passwordHash);
      console.log(`Seeded ${user.role}: ${user.email}`);
    }

    console.log(`Development password: ${DEV_PASSWORD}`);
  } finally {
    await pool.end();
  }
}

seedDevData().catch((error) => {
  console.error(error);
  process.exit(1);
});
