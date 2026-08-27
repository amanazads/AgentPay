import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, testConnection } from '../config/database.js';
import env from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function migrate() {
  console.log('[Migrate] Starting database migration...');
  console.log('[Migrate] Database:', env.DATABASE_URL.replace(/\/\/.*@/, '//<credentials>@'));

  const connected = await testConnection();
  if (!connected) {
    console.error('[Migrate] Cannot connect to database. Exiting.');
    process.exit(1);
  }

  // Create migrations tracking table
  await query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Get applied migrations
  const applied = await query('SELECT filename FROM migrations ORDER BY id');
  const appliedSet = new Set(applied.rows.map((r) => r.filename));

  // Get migration files
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`[Migrate] Skipping (already applied): ${file}`);
      continue;
    }

    console.log(`[Migrate] Applying: ${file}`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    
    try {
      await query(sql);
      await query('INSERT INTO migrations (filename) VALUES ($1)', [file]);
      console.log(`[Migrate] Applied: ${file}`);
      count++;
    } catch (err) {
      console.error(`[Migrate] Failed on ${file}:`, err.message);
      process.exit(1);
    }
  }

  console.log(`[Migrate] Done. Applied ${count} migration(s).`);
  process.exit(0);
}

migrate();
