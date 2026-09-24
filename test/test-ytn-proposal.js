// Against the REAL synchronised mainnet node: a block built by lib/blockBuilder.js from the node's own getblocktemplate (any nonce) is put to the node as a
// block proposal (getblocktemplate mode "proposal": the node validates everything but the proof of work: coinbase, the developer output,
// the merkle root, the header fields). The answer must be null. Needs a running yentend (config.node like the pool's) and a valid pool address.
// Run: node test/test-ytn-proposal.js [config.json]
const path = require('path');
const fs = require('fs');
global.config = JSON.parse(fs.readFileSync(process.argv[2] || path.join(__dirname, '..', 'config.json'), 'utf8'));
const rpc = require('../lib/ytnRpc.js');
const builder = require('../lib/blockBuilder.js');
const utils = require('../lib/utils.js');
let failed = 0;
const check = (name, ok, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra !== undefined ? '  ' + extra : '')); if (!ok) failed++; };
const call = (m, p) => new Promise((res, rej) => rpc.call(m, p, (e, r) => e ? rej(e) : res(r)));

(async () => {
	const poolScript = utils.addressScript(config.poolServer.poolAddress);
	check('the pool address of the config is valid', !!poolScript, config.poolServer.poolAddress);
	if (!poolScript) process.exit(1);
	const t = await call('getblocktemplate', [{rules: ['segwit']}]);
	check('the node gives a template with the developer output', t.coinbasevalue > 0 && !!(t.developer && t.developer.amount > 0), 'height ' + t.height + ', developer ' + JSON.stringify(t.developer));
	const job = builder.buildJob(t, poolScript, 8, config.poolServer.coinbaseTag);
	const extra = Buffer.from('0102030405060708', 'hex');
	const cb = builder.coinbaseFor(job, extra);
	const merkle = builder.merkleRootFromBranches(cb.txid, job.branches);
	const header = builder.buildHeader(job, merkle, job.time, 12345);
	const blockHex = builder.serializeBlock(job, header, cb.tx);
	const answer = await call('getblocktemplate', [{mode: 'proposal', data: blockHex}]);
	check('the node accepts the block built by the pool as a proposal (answer null = valid)', answer === null, JSON.stringify(answer));
	// a wrong pool output must be refused, proving that the check is real
	const bad = builder.buildJob(Object.assign({}, t, {coinbasevalue: t.coinbasevalue + 1}), poolScript, 8, config.poolServer.coinbaseTag);
	const bcb = builder.coinbaseFor(bad, extra);
	const bhex = builder.serializeBlock(bad, builder.buildHeader(bad, builder.merkleRootFromBranches(bcb.txid, bad.branches), bad.time, 1), bcb.tx);
	const badAnswer = await call('getblocktemplate', [{mode: 'proposal', data: bhex}]);
	check('a block that pays one atom too much is refused', badAnswer !== null, JSON.stringify(badAnswer));
	console.log(failed ? '\n' + failed + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
	process.exit(failed ? 1 : 0);
})().catch(e => { console.error('test crashed:', e); process.exit(2); });
