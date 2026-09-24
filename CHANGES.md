# Changes

## 1.0.0

* First release: Yenten (YTN, yespower 1.0 N=4096 r=16) pool derived from scash-nodejs-pool, veil-nodejs-pool, qwc-nodejs-pool and epic-nodejs-pool.
* The pool builds the blocks itself from `getblocktemplate` (called with the segwit rule; `lib/blockBuilder.js`): a plain coinbase (BIP34 height, extranonce, the pool's output, the 10% community output
  the template names in `developer`, the witness commitment if present), the merkle branch and the 80 byte header; a solved block is sent with `submitblock`.
* `lib/pool.js` speaks Bitcoin Stratum v1 (prevhash with every 4 byte word reversed, version / ntime / nbits big endian, the nonce as the hex of the number, extranonce1 of
  4 bytes and extranonce2 of 4 bytes). Job ids are per miner (`<job>.<n>`) and carry the difficulty of that miner: the miner applies a new difficulty with its next job.
* `hasher/yphash` is a small C program around the yespower sources of the Yenten node (`hasher/yespower`, BSD license): `make -C hasher`, no other dependency.
* Payments and unlocker as in Bitcoin based pools (`sendmany`, `gettransaction`, coinbase maturity 100), base58 addresses (`Y...`, `7...`).
* The variable difficulty of a worker is remembered across reconnects (`poolServer.diffMemoryMinutes`, default 15).
* Tests: address handling, the yespower hash of real mainnet blocks, and a block built by the pool from a real node's template validated by that node as a proposal.
* Not yet checked on a block found on mainnet: the payout with the real wallet (`sendmany` with `subtractfeefrom`).
