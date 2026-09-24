// The YespowerR16 helper against REAL Yenten mainnet blocks (test/real-blocks.json: the 80 byte headers of blocks of the chain): the hash of every header must not be above
// Blocks below height 1500000 are hashed differently by the node (older Yenten algorithms), so only the yespower check is meaningful for them.
// the target of its nbits, and the block hash of the node (double SHA256 of the header) must be the one recorded. A wrong helper would pass a block only by chance (about 1 in 2^18).
// Needs the helper: make -C hasher.   Run: node test/test-real-blocks.js
const path = require('path');
const crypto = require('crypto');
const {execFileSync} = require('child_process');
const blocks = require('./real-blocks.json');
const HASHER = path.join(__dirname, '..', 'hasher', 'yphash');
let failed = 0;
const check = (name, ok, extra) => { console.log((ok ? 'ok   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!ok) failed++; };
const sha256d = b => crypto.createHash('sha256').update(crypto.createHash('sha256').update(b).digest()).digest();

for (const b of blocks) {
	const header = Buffer.from(b.header, 'hex');
	const bits = parseInt(b.bits, 16);
	const target = BigInt(bits & 0x7fffff) << BigInt(8 * ((bits >>> 24) - 3));
	const hash = execFileSync(HASHER, ['--hash', b.header]).toString().trim();
	const value = BigInt('0x' + Buffer.from(hash, 'hex').reverse().toString('hex'));
	check('block ' + b.height + ': YespowerR16 hash is below the target', value <= target, hash.slice(0, 16));
	if (b.height >= 1500000) check('block ' + b.height + ': the block hash is the double SHA256 of the header', Buffer.from(sha256d(header)).reverse().toString('hex') === b.hash);
}
console.log(failed ? '\n' + failed + ' check(s) failed' : '\nall checks passed');
process.exit(failed ? 1 : 0);
