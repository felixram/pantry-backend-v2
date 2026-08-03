import { beforeAll, afterAll, afterEach } from 'vitest';
import { config } from 'dotenv';

// Load test environment variables
config({ path: '.env.test' });

// Global test setup
beforeAll(async () => {
  console.log('🔧 Test database setup complete');
});

// Clean up after each test
afterEach(async () => {
  // Optional: truncate tables between tests
  // await db.execute(sql`TRUNCATE TABLE ...`);
});

// Global test teardown
afterAll(async () => {
  console.log('✅ Test suite complete');
});
