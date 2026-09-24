# ytn-nodejs-pool

Mining pool software for **Yenten (YTN)** written in Node.js: a stratum server for Yenten's **yespower** (the standard Bitcoin Stratum protocol), share checking, block building from the
node's block template (a plain Bitcoin style coinbase that also pays the 10% community output the consensus requires), block accounting through the pool wallet, and batch payouts. It is a fork of
[cryptonote-nodejs-pool](https://github.com/dvandal/cryptonote-nodejs-pool) by Dvandal (GNU GPL v2) and of its adaptations
[scash-nodejs-pool](https://github.com/newsmoneymaker/scash-nodejs-pool), [veil-nodejs-pool](https://github.com/newsmoneymaker/veil-nodejs-pool),
[qwc-nodejs-pool](https://github.com/newsmoneymaker/qwc-nodejs-pool) and [c64-nodejs-pool](https://github.com/newsmoneymaker/c64-nodejs-pool), written for the Bitcoin Core (0.16) based node and
wallet RPC of Yenten. Live example: <https://ytn.pool-pay.com>.

## What it does

* **Stratum server** (plain TCP and TLS ports, Bitcoin Stratum v1 in the form yespower miners such as [poolpayminer](https://github.com/newsmoneymaker/poolpayminer), XMRig-style and cpuminer-opt miners use):
  the pool asks the node for a block template (`getblocktemplate`), **builds the block itself** (a coinbase with the BIP34 height, the extranonce, the pool's output, the community
  output (10% of the subsidy) that Yenten's consensus demands, the SegWit witness commitment when the template has one; the merkle branch; the 80 byte header) and sends every miner `mining.notify` with a share
  difficulty that follows the miner's hashrate (vardiff, remembered across reconnects). It checks every share itself with a small C++ helper (`hasher/yphash`): the yespower hash of the header,
  computed with the yespower sources of the Yenten node (`hasher/yespower`, BSD license). A share that meets the network target is submitted to the node as a whole block with `submitblock`.
* **Yenten proof of work:** yespower 1.0 with N=4096, r=16 (8 MB of memory per hash; blocks with a time up to 1553904000 use yespower 0.5 with the key "Client Key", which the helper also handles) over the
  80 byte header; the hash as a little endian number must not be above the target. Block time 2 minutes, 50 YTN halved every 800000 blocks; since height 2029999 10% of the subsidy goes to the
  community address inside the coinbase, so miners get 90%.
* **Accounts** are Yenten addresses (`Y...` P2PKH, or `7...` P2SH; base58check verified), optionally `.worker` or `+worker`, with a reward mode prefix `prop:` (shared, default) or `solo:`.
* **Rewards:** PROP with time weighting (slush) or SOLO.
* **Block unlocker:** a block is settled after `depth` blocks (coinbase maturity is 100). The reward is what the pool wallet received in the block's coinbase transaction (`gettransaction`);
  a block that is no longer on the chain is marked orphaned and nothing is credited.
* **Payment processor:** everyone who is due is paid in **one `sendmany` transaction per round**. The balance is debited before sending; a batch whose outcome is unknown (crash, timeout) is found
  again in the wallet by its comment and never sent twice; refused or stuck batches go back to the balances. Dry-run mode, a whitelist for rehearsals and an emergency brake (`deployment/pause-payments.sh`).
* **Website and API:** a ready website (`website_example/`) with the dashboard and its graphs, blocks, payments, top miners, worker statistics, a "Getting started" page with a config generator,
  and the public read-only JSON API.
* **Protection against connection floods:** limits per IP, a login deadline, an optional IP allow list, banning of miners with many invalid shares.
* **Tests** (`test/`): address handling, the yespower helper against **real Yenten mainnet blocks** (`test-real-blocks.js`), and `test-ytn-proposal.js`, which builds a block from the template of a
  **real, synchronised node** and lets the node validate it as a block proposal (coinbase, developer output, merkle root: the node answers `null`), and refuses a block that pays one atom too much.

## Developer donation

The pool can take a **developer donation** from the reward of every block it finds, before the miners' shares are computed (`blockUnlocker.donations`, a table `Yenten address -> percent`, up to 10% per
entry; **empty by default in `config_examples/ytn.json`**). It is your pool and the license is the GPL: set what you want and tell your miners the truth about the fees of your pool. This has nothing to do
with the miner poolpayminer (a separate project with its own fee).

## Installation

See [docs/INSTALL.md](docs/INSTALL.md): the Yenten node and wallet (build from source, or the project's release binaries and bootstrap), the yespower helper, Redis, the pool services (systemd templates in
`deployment/`), the website and the first payout rehearsal.

Requirements: Linux, Node.js 18 or newer, Redis, a Yenten node (`yentend`, 4.0.3.x / 6.x) synchronised with the network, a C compiler for the helper, a web server for the website and a
TLS certificate for the TLS stratum ports.

## Miners

[poolpayminer](https://github.com/newsmoneymaker/poolpayminer) (Windows and Linux, free, has its own fee) knows it as `-a yespower-r16`.
Example: `poolpayminer -a yespower-r16 --tls -o ytn.pool-pay.com:3901 -u YYourAddress+rigname -p x -k`.

## Tests

```
npm install
node test/test-account.js                  # address handling, needs nothing else
make -C hasher                             # the yespower helper, needs only a C compiler
node test/test-real-blocks.js              # the hash of real mainnet blocks, needs only the helper
node test/test-ytn-proposal.js config.json   # needs a running synchronised yentend (config.node) and poolServer.poolAddress from its wallet
```

## Money warning

The payment processor moves real coins. Rehearse first: `"dryRun": true`, then a whitelist (`onlyAccounts`) with a few small payouts of your own, then enable it. A transaction that has been sent to the
network can not be cancelled. Keep the wallet backup (`dumpwallet` / `backupwallet`) and the RPC password private.

## License and credits

GNU GPL v2 (see LICENSE), like the original. Based on cryptonote-nodejs-pool by Dvandal and contributors. The block builder, the Bitcoin Stratum server, the yespower helper and the Yenten adaptation are
part of this project.
