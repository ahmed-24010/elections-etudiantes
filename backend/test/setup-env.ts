process.env.DATABASE_URL = 'mysql://u:p@localhost:3306/db';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(32);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(32);
process.env.TWO_FACTOR_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.AUDIT_IP_SALT = 'test-salt-test-salt';
process.env.LOG_LEVEL = 'fatal';
