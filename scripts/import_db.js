/**
 * CricMilan Database Importer
 * Usage:
 *   1. Local SQLite:
 *      node scripts/import_db.js
 *
 *   2. Remote Turso / Vercel LibSQL Database:
 *      TURSO_DATABASE_URL="libsql://your-db.turso.io" TURSO_AUTH_TOKEN="your-token" node scripts/import_db.js
 *
 *   3. Custom backup file:
 *      node scripts/import_db.js ./backups/db_backup_latest.json
 */

const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');

async function importDatabase() {
  const backupFilePath = process.argv[2] || path.join(__dirname, '../backups/db_backup_latest.json');
  
  if (!fs.existsSync(backupFilePath)) {
    console.error(`Backup file not found at: ${backupFilePath}`);
    process.exit(1);
  }

  const rawData = fs.readFileSync(backupFilePath, 'utf8');
  const backup = JSON.parse(rawData);

  console.log(`Loading backup created at: ${backup.exportedAt}`);
  console.log(`Source type: ${backup.source}`);

  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  let client;
  if (tursoUrl) {
    console.log('Connecting to target Remote Turso / Vercel DB:', tursoUrl);
    client = createClient({ url: tursoUrl, authToken: tursoToken });
  } else {
    const targetDbPath = process.env.TARGET_DB_PATH 
      ? path.resolve(process.env.TARGET_DB_PATH).replace(/\\/g, '/')
      : path.join(process.cwd(), 'database.db').replace(/\\/g, '/');
    const fileUrl = targetDbPath.startsWith('/') ? `file:${targetDbPath}` : `file:/${targetDbPath}`;
    console.log('Connecting to target local SQLite DB at:', fileUrl);
    client = createClient({ url: fileUrl });
  }

  try {
    for (const [tableName, tableData] of Object.entries(backup.tables)) {
      console.log(`\nImporting table: ${tableName} (${tableData.rowCount} rows)...`);

      // 1. Ensure table schema exists
      if (tableData.schema) {
        await client.execute(tableData.schema);
      }

      // 2. Insert or replace each row
      let importedCount = 0;
      for (const row of tableData.rows) {
        const keys = Object.keys(row);
        const placeholders = keys.map(() => '?').join(', ');
        const cols = keys.map(k => `\`${k}\``).join(', ');
        const values = keys.map(k => row[k]);

        await client.execute({
          sql: `INSERT OR REPLACE INTO \`${tableName}\` (${cols}) VALUES (${placeholders})`,
          args: values
        });
        importedCount++;
      }

      console.log(`✔ Successfully imported ${importedCount} rows into [${tableName}].`);
    }

    console.log('\n=============================================');
    console.log('SUCCESS! All database records imported.');
    console.log('=============================================');
  } catch (err) {
    console.error('Import failed with error:', err);
    process.exit(1);
  }
}

importDatabase();
