/**
 * Yenten Pool (based on cryptonote-nodejs-pool, GPL-2.0)
 *
 * Wrapper around the yphash helper (hasher/yphash.cpp): the YespowerR16 hash of an 80 byte block header, for share validation.
 * Settings in config.hasher: {path, threads}: `threads` helper processes, requests go round robin.
 *   hash(headerHex, cb)   cb(err, hashHex): 32 bytes as computed (a little endian number)
 * A helper is restarted when it dies.
 **/
let spawn = require('child_process').spawn;
let path = require('path');

let hasherConfig = config.hasher || {};
let log_ = function (level, text, args) { log(level, 'hasher', text, args || []); };

let helpers = [];
let next = 0;
let nextId = 1;

function start (index) {
	let file = hasherConfig.path || path.join(__dirname, '..', 'hasher', 'yphash');
	let helper = {index: index, child: null, buffer: '', pending: new Map(), restartTimer: null};
	helpers[index] = helper;

	let child = spawn(file, [], {stdio: ['pipe', 'pipe', 'inherit']});
	helper.child = child;
	child.stdout.setEncoding('utf8');
	child.stdout.on('data', function (data) {
		helper.buffer += data;
		let idx;
		while ((idx = helper.buffer.indexOf('\n')) !== -1) {
			let line = helper.buffer.slice(0, idx);
			helper.buffer = helper.buffer.slice(idx + 1);
			let parts = line.split(' ');
			if (parts[0] !== 'H') continue;
			let cb = helper.pending.get(parts[1]);
			if (!cb) continue;
			helper.pending.delete(parts[1]);
			if (parts[2] === 'err' || !parts[2]) cb(new Error('hasher error')); else cb(null, parts[2]);
		}
	});
	child.stdin.on('error', function () {});
	child.on('error', function (err) {
		log_('error', 'Cannot run %s: %s', [file, err.message]);
	});
	child.on('exit', function (code, signal) {
		log_('error', 'yphash exited (code %s, signal %s), restarting in 3 s', [code, signal]);
		helper.child = null;
		helper.pending.forEach(function (cb) { cb(new Error('hasher restarted')); });
		helper.pending.clear();
		clearTimeout(helper.restartTimer);
		helper.restartTimer = setTimeout(function () { start(index); }, 3000);
	});
}

for (let i = 0; i < (hasherConfig.threads || 2); i++) start(i);

exports.isReady = function () { return helpers.some(function (h) { return h && h.child; }); };

exports.hash = function (headerHex, callback) {
	for (let tries = 0; tries < helpers.length; tries++) {
		let helper = helpers[next++ % helpers.length];
		if (!helper || !helper.child) continue;
		let id = 'j' + (nextId++);
		helper.pending.set(id, callback);
		helper.child.stdin.write('H ' + id + ' ' + headerHex + '\n');
		return;
	}
	callback(new Error('hasher not ready'));
};

exports.stop = function () {
	helpers.forEach(function (helper) {
		if (!helper) return;
		clearTimeout(helper.restartTimer);
		if (helper.child) {
			helper.child.removeAllListeners('exit');
			helper.child.stdin.write('Q\n');
			helper.child = null;
		}
	});
};
