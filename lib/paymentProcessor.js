/**
 * Payment processor for Yenten (adapted from cryptonote-nodejs-pool, GPL-2.0).
 *
 * Yenten payouts are ordinary wallet transactions: all miners that are due are paid in ONE
 * `sendmany` transaction per round, which makes the network fee a few percent of a single payout instead of a
 * fee per miner. A batch is tracked in redis, because a crash between "money left the wallet" and "we know it"
 * must neither lose nor double a payout:
 *
 *   balance -> [debit + record in <coin>:payments:pending, state "sending", comment "pool-payout:<id>"]
 *           -> wallet sendmany -> state "sent" (txid known) -> confirmations >= minConfirmations -> paid
 *           -> or: the wallet refused / the transaction never appeared / was abandoned -> the amounts go back to the balances.
 *
 * Safety rules: the balance is debited BEFORE anything is sent (a crash can lose a payout attempt, never double it);
 * a batch whose outcome is unknown ("sending" for more than unknownAfterSeconds) is matched against the wallet's
 * transaction log by its comment, and only refunded when the wallet has no such transaction. An account with an open
 * payout is skipped. dryRun logs what would be paid and sends nothing.
 *
 * config.payments: enabled, dryRun (true = only log), interval (s), minPayment (atoms), maxTransactionAmount (per account
 * and payout), maxPaymentsPerRound (accounts in one transaction), minConfirmations, pendingTimeoutHours, reserve (atoms kept
 * in the wallet), minerPayFee (true = the network fee is shared by the paid miners, false = the pool pays it),
 * onlyAccounts (if not empty only these are paid: for rehearsals), stopFile (emergency brake).
 **/

let async = require('async');
let crypto = require('crypto');
let fs = require('fs');
let path = require('path');

let rpc = require('./ytnRpc.js');
let utils = require('./utils.js');

let logSystem = 'payments';
require('./exceptionWriter.js')(logSystem);

let pc = config.payments;
let UNITS = config.coinUnits || 100000000;
let interval = (pc.interval || 300) * 1000;
let minConfirmations = pc.minConfirmations || 10;
let timeoutHours = pc.pendingTimeoutHours || 48;
let reserve = pc.reserve >= 0 ? pc.reserve : 1000000;
let maxPerRound = pc.maxPaymentsPerRound || 50;
let dryRun = pc.dryRun !== false;              // anything but an explicit false means: do not send
let minerPayFee = pc.minerPayFee !== false;
let onlyAccounts = pc.onlyAccounts || [];
// Emergency brake: while this file exists no NEW payout is started (payouts already in flight are still settled).
// deployment/pause-payments.sh creates it, deployment/resume-payments.sh removes it. Checked before every payout.
let stopFile = pc.stopFile || path.join(__dirname, '..', 'STOP_PAYMENTS');
let paused = function () { return fs.existsSync(stopFile); };
let UNKNOWN_AFTER = (pc.unknownAfterSeconds || 120) * 1000;

let pendingKey = config.coin + ':payments:pending';
let workerKey = function (account) { return config.coin + ':workers:' + account; };
let coins = function (amount) { return utils.getReadableCoins(amount); };
let toAtoms = function (value) { return Math.round(parseFloat(value) * UNITS); };
let toCoins = function (atoms) { return Number((atoms / UNITS).toFixed(8)); };
let errText = function (e) { return e ? (e.message || JSON.stringify(e)) : 'unknown error'; };
// an RPC error object with a code = the node answered "no"; anything else (timeout, connection lost) = outcome unknown
let isRefusal = function (e) { return e && typeof e.code === 'number' && !(e instanceof Error); };

log('info', logSystem, 'Started%s: min payment %s, at most %s per account, up to %d accounts per transaction, every %ds, fee %s',
	[dryRun ? ' in DRY RUN mode (nothing is sent)' : '', coins(pc.minPayment), coins(pc.maxTransactionAmount || 0), maxPerRound, interval / 1000,
	minerPayFee ? 'paid by the miners' : 'paid by the pool']);

/**
 * Bookkeeping in redis (every change is one transaction)
 **/
function savePending (entry, callback) {
	redisClient.hset(pendingKey, entry.id, JSON.stringify(entry), callback);
}

function refund (entry, reason, callback) {
	log('warn', logSystem, 'Payout %s (%d account(s), %s) is returned to the balances: %s', [entry.id, entry.items.length, coins(entry.items.reduce(function (s, i) { return s + i.amount; }, 0)), reason]);
	let commands = [];
	entry.items.forEach(function (item) {
		commands.push(['hincrby', workerKey(item.account), 'balance', item.amount]);
		commands.push(['hincrby', workerKey(item.account), 'pending', -item.amount]);
	});
	commands.push(['hdel', pendingKey, entry.id]);
	redisClient.multi(commands).exec(function (error) {
		if (error) log('error', logSystem, 'Could not return payout %s to the balances %j', [entry.id, error]);
		callback();
	});
}

function complete (entry, tx, height, callback) {
	let now = Math.floor(Date.now() / 1000);
	let totalFee = Math.abs(toAtoms(tx.fee || 0)) || entry.fee || 0;
	let feeShare = Math.floor(totalFee / entry.items.length);
	let commands = [];
	entry.items.forEach(function (item) {
		// member layout of the payments lists: txid:amount:fee:mixin:recipients:height (the website reads it)
		let member = [tx.txid, item.amount, feeShare, 0, entry.items.length, height].join(':');
		commands.push(['hincrby', workerKey(item.account), 'pending', -item.amount]);
		commands.push(['hincrby', workerKey(item.account), 'paid', item.amount]);
		commands.push(['zadd', config.coin + ':payments:all', now, member]);
		commands.push(['zadd', config.coin + ':payments:' + item.account, now, member]);
	});
	commands.push(['hdel', pendingKey, entry.id]);
	log('info', logSystem, 'Paid %d account(s) in transaction %s (fee %s)', [entry.items.length, tx.txid, coins(totalFee)]);
	redisClient.multi(commands).exec(function (error) {
		if (error) log('error', logSystem, 'Could not record the payment %s %j', [entry.id, error]);
		callback();
	});
}

/**
 * Step 1: settle what is in flight
 **/
function reconcileEntry (entry, callback) {
	let age = Date.now() - entry.ts;

	// The outcome of sendmany is unknown (crash, timeout): look for the transaction by its comment in the wallet log
	if (entry.state === 'sending') {
		if (age < UNKNOWN_AFTER) return callback();
		rpc.call('listtransactions', ['*', 300], function (error, txs) {
			if (error) {
				log('error', logSystem, 'Cannot reconcile payout %s: %s', [entry.id, errText(error)]);
				return callback();
			}
			let match = (txs || []).find(function (tx) { return tx.comment === entry.comment && tx.category === 'send'; });
			if (!match) return refund(entry, 'the wallet has no such transaction', callback);
			entry.state = 'sent';
			entry.txid = match.txid;
			log('info', logSystem, 'Payout %s found in the wallet log as transaction %s', [entry.id, entry.txid]);
			savePending(entry, function () { callback(); });
		});
		return;
	}

	rpc.call('gettransaction', [entry.txid], function (error, tx) {
		if (error) {
			log('error', logSystem, 'Payout %s: cannot read transaction %s (%s), leaving it for a manual check', [entry.id, entry.txid, errText(error)]);
			return callback();
		}
		let confirmations = tx.confirmations;
		if (confirmations >= minConfirmations) {
			return rpc.call('getblock', [tx.blockhash, 1], function (blockError, block) {
				complete(entry, tx, block && block.height ? block.height : '', callback);
			});
		}
		if (confirmations < 0) return refund(entry, 'the transaction was conflicted by another one', callback);

		if (confirmations === 0 && age > timeoutHours * 3600 * 1000) {
			rpc.call('abandontransaction', [entry.txid], function (abandonError) {
				if (abandonError) {
					log('error', logSystem, 'Cannot abandon the stuck transaction %s: %s', [entry.txid, errText(abandonError)]);
					return callback();
				}
				refund(entry, 'not confirmed within ' + timeoutHours + ' hours, transaction abandoned', callback);
			});
			return;
		}
		callback();
	});
}

function reconcile (callback) {
	redisClient.hgetall(pendingKey, function (error, all) {
		if (error) {
			log('error', logSystem, 'Cannot read the open payouts %j', [error]);
			return callback(true);
		}
		let entries = Object.keys(all || {}).map(function (id) { return JSON.parse(all[id]); });
		if (entries.length) log('info', logSystem, '%d payout transaction(s) in flight', [entries.length]);
		async.eachSeries(entries, reconcileEntry, function () { callback(null); });
	});
}

/**
 * Step 2: new payouts, all due accounts in one transaction
 **/
function sendBatch (entry, callback) {
	let amounts = {};
	entry.items.forEach(function (item) { amounts[item.dest] = toCoins(item.amount); });
	let subtractFrom = minerPayFee ? entry.items.map(function (item) { return item.dest; }) : [];

	redisClient.multi([].concat.apply([], entry.items.map(function (item) {
		return [['hincrby', workerKey(item.account), 'balance', -item.amount], ['hincrby', workerKey(item.account), 'pending', item.amount]];
	})).concat([['hset', pendingKey, entry.id, JSON.stringify(entry)]])).exec(function (error) {
		if (error) {
			log('error', logSystem, 'Could not book the payout %s %j', [entry.id, error]);
			return callback();
		}

		rpc.call('sendmany', ['', amounts, minConfirmations, entry.comment, subtractFrom], function (error, txid) {
			if (error && isRefusal(error)) {
				// the node said no (not enough funds, invalid address ...): nothing was sent
				log('error', logSystem, 'The wallet refused the payout: %s', [errText(error)]);
				return refund(entry, 'the wallet refused it: ' + errText(error), callback);
			}
			if (error || typeof txid !== 'string') {
				// outcome unknown: the record stays in state "sending" and is reconciled with the wallet log later
				log('error', logSystem, 'Sending to %d account(s) failed or is unclear: %s (the record is kept, it is checked against the wallet)', [entry.items.length, errText(error || 'no txid')]);
				return callback();
			}
			entry.state = 'sent';
			entry.txid = txid;
			log('info', logSystem, 'Sent %s to %d account(s) in transaction %s', [coins(entry.items.reduce(function (s, i) { return s + i.amount; }, 0)), entry.items.length, txid]);
			savePending(entry, function () { callback(); });
		}, {timeout: 120000});
	});
}

function newPayouts (callback) {
	if (paused()) {
		log('warn', logSystem, 'PAUSED: %s exists, no new payouts are started', [stopFile]);
		return callback(null);
	}

	redisClient.keys(workerKey('*'), function (error, keys) {
		if (error) {
			log('error', logSystem, 'Cannot list the accounts %j', [error]);
			return callback(true);
		}
		let commands = keys.map(function (k) { return ['hmget', k, 'balance', 'pending', 'minPayoutLevel']; });
		redisClient.multi(commands).exec(function (error, replies) {
			if (error) {
				log('error', logSystem, 'Cannot read the balances %j', [error]);
				return callback(true);
			}

			let due = [];
			keys.forEach(function (key, i) {
				let account = key.substring((config.coin + ':workers:').length);
				let balance = parseInt(replies[i][0]) || 0;
				let pending = parseInt(replies[i][1]) || 0;
				let level = Math.max(pc.minPayment, parseInt(replies[i][2]) || 0);
				if (pending > 0 || balance < level) return;
				if (!utils.validateMinerAddress(account)) return;
				if (onlyAccounts.length && onlyAccounts.indexOf(account) === -1) return;
				due.push({account: account, dest: account, amount: Math.min(balance, pc.maxTransactionAmount || balance)});
			});

			if (due.length === 0) {
				log('info', logSystem, 'Nobody is due for a payment');
				return callback(null);
			}

			due.sort(function (a, b) { return b.amount - a.amount; });
			due = due.slice(0, maxPerRound);

			if (dryRun) {
				due.forEach(function (d) { log('info', logSystem, '[dry run] would pay %s to %s', [coins(d.amount), d.dest]); });
				return callback(null);
			}

			rpc.call('getbalance', ['*', minConfirmations], function (error, spendable) {
				if (error) {
					log('error', logSystem, 'Cannot read the wallet balance: %s', [errText(error)]);
					return callback(true);
				}
				let budget = toAtoms(spendable) - reserve;
				log('info', logSystem, 'Wallet: %s spendable (%s kept in reserve), %d account(s) due', [coins(toAtoms(spendable)), coins(reserve), due.length]);

				// the batch must fit into the wallet (largest payouts first)
				let items = [];
				due.forEach(function (d) {
					if (d.amount > budget) {
						log('warn', logSystem, 'Not enough spendable funds for %s to %s (budget %s)', [coins(d.amount), d.account, coins(Math.max(budget, 0))]);
						return;
					}
					budget -= d.amount;
					items.push(d);
				});
				if (items.length === 0) return callback(null);
				if (paused()) {
					log('warn', logSystem, 'PAUSED: %s appeared, this round is skipped', [stopFile]);
					return callback(null);
				}

				let id = crypto.randomBytes(6).toString('hex');
				sendBatch({id: id, comment: 'pool-payout:' + id, items: items, ts: Date.now(), state: 'sending'}, function () { callback(null); });
			});
		});
	});
}

/**
 * Run payment processor
 **/
function runInterval () {
	async.waterfall([reconcile, newPayouts], function () {
		setTimeout(runInterval, interval);
	});
}

runInterval();
