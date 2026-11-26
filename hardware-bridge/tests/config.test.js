const test = require('node:test');
const assert = require('node:assert');
const { defaultConfig, loadConfig } = require('../dist/configuration/config');

test('defaultConfig has port 8765', () => {
  const c = defaultConfig();
  assert.equal(c.port, 8765);
  assert.equal(c.host, '127.0.0.1');
  assert.ok(Array.isArray(c.allowedOrigins));
  assert.equal(c.paired, false);
});