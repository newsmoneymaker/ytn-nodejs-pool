# Installing a Yenten pool

Paths below are examples: the pool in `/opt/ytn-nodejs-pool`, the node and its data in `/opt/ytn`, all run by the user `ytnpool`
(the systemd templates in `deployment/systemd/` use these paths).

## 1. Yenten node and wallet

Yenten Core (`https://github.com/yentencoin/yenten`, branch `yenten-6`, MIT) is a Bitcoin Core 0.16 based node. Its releases carry binaries; on a host with an old glibc/GCC (Debian 10 has GCC 8)
build from source in a newer userland, for example a Debian 12 chroot made with `debootstrap`. **No source patch was needed with GCC 12.** The source uses its own `depends` system.

```
git clone -b yenten-6 https://github.com/yentencoin/yenten && cd yenten
# build dependencies: curl build-essential libtool autotools-dev automake pkg-config python3 bsdmainutils patch bison xz-utils unzip p7zip-full
make -C depends NO_QT=1 NO_UPNP=1 NO_NATPMP=1 -j4
./autogen.sh
./configure --prefix=$PWD/depends/x86_64-pc-linux-gnu --without-gui --disable-tests --disable-bench --with-incompatible-bdb --disable-man
make -j4                                                    # src/yentend, src/yenten-cli
```

`/opt/ytn/data/yenten.conf`:

```
server=1
listen=1
daemon=0
rpcuser=ytnpool
rpcpassword=<a long random password>
rpcbind=127.0.0.1
rpcallowip=127.0.0.1
rpcport=9982
port=9981
maxconnections=40
dbcache=512
addnode=seed-main.yentencoin.info
```

**Use the project's block data snapshot.** Validating the chain from the genesis block computes a yespower hash per header and takes long. The project publishes a snapshot of the data directory
(`yenten_block_data_standard.7z`, about 1.9 GB, linked from its GitHub page / website; unpack it with `7z x` into the data directory, keep `yenten.conf`). Start the node: it catches up the last few
thousand blocks by itself (`yenten-cli getblockchaininfo`). Block templates are served as soon as the blockchain is synced. **Yenten needs `getblocktemplate` with the segwit rule**
(`{"rules":["segwit"]}`), which the pool does.

The default wallet of the node is the pool wallet:

```
yenten-cli getnewaddress "pool"          # Y... : the pool address (poolServer.poolAddress)
yenten-cli dumpwallet /safe/place/ytn-wallet-dump.txt   # the private keys: keep it offline, chmod 600 (also: yenten-cli backupwallet <file>)
```

The wallet is a plain (non HD) wallet with a key pool: back it up again after new addresses were handed out.

**Community output.** Since height 2029999 the consensus (`ConnectBlock`) requires the coinbase to pay the community address `YentenDWKCJPE9GVN48ecgW7j73xKN4PW7` 10% of the subsidy. The node names it in the
`developer` field of the template; the pool builds the block with it and only the rest (90% plus fees) belongs to the pool and its miners.

## 2. yespower helper

The helper (`hasher/yphash`) is a tiny C program around the yespower sources of the node (`hasher/yespower`, BSD license): `cd hasher && make` (needs only a C compiler; `STATIC=-static` for a
binary that runs anywhere). Check it against the chain: `node test/test-real-blocks.js`. A hash takes about 4-8 ms; `hasher.threads` helper processes work in parallel (each share is one hash).

## 3. Redis

Use a dedicated instance with a password and AOF (`deployment/redis-pool.conf.example`, unit `ytn-pool-redis`, port 6387).

## 4. The pool

```
cd /opt/ytn-nodejs-pool && npm install --production
cp config_examples/ytn.json config.json      # then edit it
```

Edit `config.json`: `poolHost`, `poolServer.poolAddress` (the wallet address of step 1), the ports and the certificate for TLS (`poolServer.sslCert/sslKey`), `redis`, `api.password`,
`node.password` or `node.passwordFile`, `blockUnlocker.poolFee` and `donations`, `payments`. **Keep `payments.dryRun: true` until the rehearsal below.**

```
cp deployment/systemd/*.service /etc/systemd/system/ && systemctl daemon-reload
systemctl enable --now ytn-pool-redis ytn-node
systemctl enable --now ytn-pool ytn-pool-api ytn-pool-unlocker ytn-pool-payments ytn-pool-charts
node test/test-ytn-proposal.js config.json        # the node itself validates a block built by the pool (needs the synchronised node)
```

The pool runs as separate modules (`init.js -module=pool|api|unlocker|payments|chartsDataCollector`), each in its own unit. Until payouts are proven, restrict the stratum ports with `poolServer.allowIPs`.
Point a miner at it: `poolpayminer -a yespower-r16 -o your.pool:3900 -u <a Y... address> -p x`.

## 5. Website

Copy `website_example/` to the web root, set `poolHost`, the contact and links in `config.js`, and proxy `/api` to the pool API on 127.0.0.1:8125 (`deployment/apache-vhost.conf.example` exposes only the
read-only methods).

## 6. Rehearse the payments

1. `payments.dryRun: true`: the log of `ytn-pool-payments` shows what would be paid.
2. Fund the pool wallet with a few coins (or wait for the first block), credit a small balance in Redis to your own test addresses (`<coin>:workers:<address>`, field `balance`), set `payments.onlyAccounts`
   to them, `dryRun: false`, and watch the payout confirm.
3. Remove the test accounts from Redis and set `onlyAccounts` to `[]`.

Good to know: block rewards can be spent after 100 blocks (about 3.5 hours); `deployment/pause-payments.sh` stops new payouts at once; the wallet must stay unlocked and online for the payouts (leave the
pool wallet unencrypted with only small balances in it). Of a block the pool only gets the subsidy minus the 10% community output the template demands, plus the fees.
