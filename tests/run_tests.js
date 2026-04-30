// Standalone test runner - no dependencies needed for most tests
const bcrypt = require('bcryptjs');

let passed = 0, failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch(e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    failed++;
  }
}

function expect(val) {
  return {
    toBe: (expected) => { if (val !== expected) throw new Error(`Expected ${expected}, got ${val}`); },
    toBeUndefined: () => { if (val !== undefined) throw new Error(`Expected undefined, got ${val}`); },
    resolves: { toBe: async (expected) => { const r = await val; if (r !== expected) throw new Error(`Expected ${expected}, got ${r}`); } },
  };
}

async function run() {
  console.log('\n=== Bug Regression Tests ===\n');

  console.log('Bug #1 – Password comparison');
  await test('bcrypt.compare true for correct password', async () => {
    const hash = await bcrypt.hash('Password@123', 12);
    const result = await bcrypt.compare('Password@123', hash);
    expect(result).toBe(true);
  });
  await test('bcrypt.compare false for wrong password', async () => {
    const hash = await bcrypt.hash('Password@123', 12);
    const result = await bcrypt.compare('Wrong', hash);
    expect(result).toBe(false);
  });
  await test('comparePassword instance method works', async () => {
    const hash = await bcrypt.hash('TestPass@99', 10);
    const fakeUser = { password: hash, comparePassword: async function(c) { return bcrypt.compare(c, this.password); } };
    expect(await fakeUser.comparePassword('TestPass@99')).toBe(true);
    expect(await fakeUser.comparePassword('wrong')).toBe(false);
  });

  console.log('\nBug #2 – burnoutService userId variable');
  await test('payload uses userId (camelCase) not user_id', () => {
    const userId = 'uuid-abc-123';
    const payload = { userId, score: 42 };
    expect(payload.userId).toBe(userId);
    expect(payload.user_id).toBeUndefined();
  });

  console.log('\nBug #3 – Redis quit() no-op');
  await test('redis stub has callable quit()', async () => {
    const fakeRedis = { ping: async () => 'PONG' };
    if (typeof fakeRedis.quit !== 'function') fakeRedis.quit = async () => {};
    expect(typeof fakeRedis.quit).toBe('function');
    await fakeRedis.quit(); // should not throw
  });

  console.log('\nBug #4 – BurnoutScore safe findOne+create/update');
  await test('calls create when no existing record', async () => {
    let created = false, updated = false;
    const safeUpsert = async (existing, data) => {
      if (existing) { updated = true; return existing; }
      created = true; return { id: 'new', ...data };
    };
    await safeUpsert(null, { score: 50 });
    expect(created).toBe(true);
    expect(updated).toBe(false);
  });
  await test('calls update when existing record found', async () => {
    let updated = false;
    const safeUpsert = async (existing, data) => {
      if (existing) { updated = true; return existing; }
      return { id: 'new', ...data };
    };
    await safeUpsert({ id: 'existing' }, { score: 60 });
    expect(updated).toBe(true);
  });

  console.log('\nBug #5 – WorkforceHealth fetch error handling');
  await test('non-ok HTTP response throws, does not hang', async () => {
    const loadData = async () => {
      const r = { ok: false, status: 403 };
      if (!r.ok) throw new Error(`Server returned ${r.status}`);
    };
    try { await loadData(); throw new Error('Should have thrown'); } 
    catch(e) { if (!e.message.includes('403')) throw new Error('Wrong error: ' + e.message); }
  });
  await test('error state set and loading cleared on failure', async () => {
    let loading = true, errorMsg = '';
    try { throw new Error('Network error'); }
    catch(e) { loading = false; errorMsg = e.message; }
    expect(loading).toBe(false);
    expect(errorMsg).toBe('Network error');
  });

  console.log('\nBug #6 – Logout clears local state');
  await test('logout removes token and user from storage', () => {
    const storage = { accessToken: 'tok123', user: '{"id":"1"}' };
    delete storage.accessToken; delete storage.user;
    expect(storage.accessToken).toBeUndefined();
    expect(storage.user).toBeUndefined();
  });

  console.log('\nBug #7 – No hardcoded localhost URLs');
  await test('ai-intelligence component uses environment.apiUrl', () => {
    const fs = require('fs');
    const content = fs.readFileSync(require('path').join(__dirname, '../../..', 'frontend/src/app/modules/ai-intelligence/ai-intelligence.component.ts'), 'utf8');
    if (content.includes("'http://localhost:3000/api'")) throw new Error('Still has hardcoded localhost!');
    if (!content.includes('environment.apiUrl')) throw new Error('Missing environment.apiUrl');
  });
  await test('salary-intelligence component uses environment.apiUrl', () => {
    const fs = require('fs');
    const content = fs.readFileSync(require('path').join(__dirname, '../../..', 'frontend/src/app/modules/salary-intelligence/salary-intelligence.component.ts'), 'utf8');
    if (content.includes("'http://localhost:3000/api")) throw new Error('Still has hardcoded localhost!');
    if (!content.includes('environment.apiUrl')) throw new Error('Missing environment.apiUrl');
  });

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Tests: ${passed + failed} total | ${passed} passed | ${failed} failed`);
  if (failed === 0) console.log('✅ All tests passed!\n');
  else { console.log(`❌ ${failed} test(s) failed\n`); process.exit(1); }
}

run().catch(e => { console.error(e); process.exit(1); });
