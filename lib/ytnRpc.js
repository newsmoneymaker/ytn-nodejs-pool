/**
 * Yenten Pool (based on cryptonote-nodejs-pool, GPL-2.0)
 *
 * JSON-RPC client of yentend (node and wallet are the same process). Settings in config.node:
 *   host, port, user, password | passwordFile (a file with the rpcpassword, one line)
 **/
let http = require('http');
let fs = require('fs');

let nodeConfig = config.node || {};

function password () {
	if (nodeConfig.password) return String(nodeConfig.password);
	if (nodeConfig.passwordFile) return fs.readFileSync(nodeConfig.passwordFile, 'utf8').trim();
	return '';
}

/**
 * call(method, params, callback(err, result)). err is {code, message} for an RPC error, an Error for a transport error.
 * options: {wallet: '<wallet name>'} selects /wallet/<name>, timeout in ms.
 **/
exports.call = function (method, params, callback, options) {
	options = options || {};
	let body = JSON.stringify({jsonrpc: '1.0', id: 'pool', method: method, params: params || []});
	let auth = Buffer.from((nodeConfig.user || '') + ':' + password()).toString('base64');
	let done = false;
	let finish = function (err, result) {
		if (done) return;
		done = true;
		callback(err, result);
	};

	let req = http.request({
		host: nodeConfig.host || '127.0.0.1',
		port: nodeConfig.port || 9982,
		path: options.wallet ? '/wallet/' + encodeURIComponent(options.wallet) : '/',
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'Content-Length': Buffer.byteLength(body),
			'Authorization': 'Basic ' + auth
		},
		timeout: options.timeout || 30000
	}, function (res) {
		let chunks = [];
		res.on('data', function (c) { chunks.push(c); });
		res.on('end', function () {
			let text = Buffer.concat(chunks).toString('utf8');
			let parsed;
			try {
				parsed = JSON.parse(text);
			} catch (e) {
				return finish(new Error('Bad answer from the node (HTTP ' + res.statusCode + '): ' + text.slice(0, 120)));
			}
			if (parsed.error) return finish(parsed.error);
			finish(null, parsed.result);
		});
	});
	req.on('timeout', function () { req.destroy(new Error('RPC timeout: ' + method)); });
	req.on('error', function (e) { finish(e); });
	req.end(body);
};
