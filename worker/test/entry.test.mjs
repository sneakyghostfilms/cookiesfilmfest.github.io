import assert from 'node:assert/strict';
import test from 'node:test';
import * as entry from '../src/index.js';

test('the entry module exports only what the Workers runtime accepts', () => {
  for (const [name, value] of Object.entries(entry)) {
    if (name === 'default') assert.equal(typeof value.fetch, 'function');
    else assert.equal(typeof value, 'function', `${name} is a ${typeof value}; workerd refuses to start on non-handler exports`);
  }
});
