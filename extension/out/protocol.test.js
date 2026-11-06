"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const assert = require("node:assert");
const protocol_1 = require("./protocol");
(0, node_test_1.test)('canonical JSON matches the app contract (sorted keys)', () => {
    assert.equal((0, protocol_1.canonicalJson)({ b: 1, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":1}');
});
(0, node_test_1.test)('signing is deterministic and payload-sensitive', () => {
    const secret = 'ab'.repeat(32);
    const a = (0, protocol_1.sign)(secret, 1000, 'n1', { title: 'npm test' });
    assert.equal(a, (0, protocol_1.sign)(secret, 1000, 'n1', { title: 'npm test' }));
    assert.notEqual(a, (0, protocol_1.sign)(secret, 1000, 'n1', { title: 'evil' }));
});
