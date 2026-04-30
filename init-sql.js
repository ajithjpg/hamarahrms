require('dotenv').config();
const fs = require('fs');
const { Client } = require('pg');

async function runInit() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();

    const sql = fs.readFileSync('./init.sql', 'utf-8');

    await client.query({
      text: sql,
      simple: true, // 🔥 MUST for your file
    });

    console.log('✅ FULL DB CREATED + DATA INSERTED');
  } catch (err) {
    console.error('❌ ERROR:', err.message);
  } finally {
    await client.end();
  }
}

runInit();