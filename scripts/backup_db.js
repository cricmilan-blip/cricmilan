const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');

async function exportDatabase() {
  const isVercel = !!process.env.VERCEL;
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  let client;
  if (tursoUrl) {
    console.log('Connecting to Turso remote database:', tursoUrl);
    client = createClient({ url: tursoUrl, authToken: tursoToken });
  } else {
    const dbPath = path.join(process.cwd(), 'database.db').replace(/\\/g, '/');
    const fileUrl = dbPath.startsWith('/') ? `file:${dbPath}` : `file:/${dbPath}`;
    console.log('Connecting to local SQLite database at:', fileUrl);
    client = createClient({ url: fileUrl });
  }

  try {
    // 1. Get all user tables
    const tablesResult = await client.execute(`
      SELECT name, sql FROM sqlite_master 
      WHERE type='table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `);

    const tables = tablesResult.rows;
    console.log(`Found ${tables.length} tables:`, tables.map(t => t.name).join(', '));

    const exportData = {
      exportedAt: new Date().toISOString(),
      source: tursoUrl ? 'turso' : 'sqlite_file',
      tables: {}
    };

    let sqlDump = `-- CricMilan Database Backup\n-- Generated at: ${new Date().toISOString()}\n\n`;

    for (const table of tables) {
      const tableName = String(table.name);
      const schemaSql = String(table.sql);

      // Get count
      const countRes = await client.execute(`SELECT COUNT(*) as cnt FROM ${tableName}`);
      const rowCount = Number(countRes.rows[0]?.cnt || 0);

      // Get all rows
      const rowsRes = await client.execute(`SELECT * FROM ${tableName}`);
      const rows = rowsRes.rows;

      exportData.tables[tableName] = {
        rowCount,
        schema: schemaSql,
        rows
      };

      console.log(`- Table [${tableName}]: ${rowCount} rows`);

      sqlDump += `-- --------------------------------------------------------\n`;
      sqlDump += `-- Table structure for ${tableName}\n`;
      sqlDump += `-- --------------------------------------------------------\n`;
      sqlDump += `${schemaSql};\n\n`;

      if (rows.length > 0) {
        sqlDump += `-- Dumping data for table ${tableName}\n`;
        for (const row of rows) {
          const keys = Object.keys(row);
          const cols = keys.map(k => `\`${k}\``).join(', ');
          const values = keys.map(k => {
            const val = row[k];
            if (val === null || val === undefined) return 'NULL';
            if (typeof val === 'number') return val;
            // Escape strings
            return `'${String(val).replace(/'/g, "''")}'`;
          }).join(', ');
          sqlDump += `INSERT OR REPLACE INTO \`${tableName}\` (${cols}) VALUES (${values});\n`;
        }
        sqlDump += `\n`;
      }
    }

    // Save JSON export
    const backupDir = path.join(process.cwd(), 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = path.join(backupDir, `db_backup_${timestamp}.json`);
    const latestJsonPath = path.join(backupDir, `db_backup_latest.json`);
    const sqlPath = path.join(backupDir, `db_backup_${timestamp}.sql`);
    const latestSqlPath = path.join(backupDir, `db_backup_latest.sql`);

    fs.writeFileSync(jsonPath, JSON.stringify(exportData, null, 2), 'utf8');
    fs.writeFileSync(latestJsonPath, JSON.stringify(exportData, null, 2), 'utf8');
    fs.writeFileSync(sqlPath, sqlDump, 'utf8');
    fs.writeFileSync(latestSqlPath, sqlDump, 'utf8');

    console.log('\n=============================================');
    console.log('SUCCESS! Database exported successfully.');
    console.log(`JSON Backup saved to: ${latestJsonPath}`);
    console.log(`SQL Dump saved to:    ${latestSqlPath}`);
    console.log('=============================================');

    return exportData;
  } catch (err) {
    console.error('Error during database export:', err);
    throw err;
  }
}

exportDatabase();
