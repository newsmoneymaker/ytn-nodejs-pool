/**
 * Yenten Pool (based on cryptonote-nodejs-pool, GPL-2.0)
 * https://github.com/dvandal/cryptonote-nodejs-pool
 *
 * Utilities functions
 **/

// Load required module
let crypto = require('crypto');

let dateFormat = require('dateformat');
exports.dateFormat = dateFormat;

/**
 * Generate random instance id
 **/
exports.instanceId = function () {
	return crypto.randomBytes(4);
}

/**
 * Yenten addresses. A miner is identified by an ordinary base58check address of the main network: P2PKH ("Y...", version byte 78)
 * or P2SH ("5...", version byte 10). Payouts are sent to it, and its script is what the coinbase of a block pays
 * to when the address is the pool's.
 **/
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const P2PKH_VERSION = (typeof config !== 'undefined' && config && config.addressVersion !== undefined) ? config.addressVersion : 78;
const P2SH_VERSION = (typeof config !== 'undefined' && config && config.scriptAddressVersion !== undefined) ? config.scriptAddressVersion : 10;

function sha256d (buf) {
	return crypto.createHash('sha256').update(crypto.createHash('sha256').update(buf).digest()).digest();
}

function base58Decode (text) {
	let num = 0n;
	for (let ch of text) {
		let idx = B58_ALPHABET.indexOf(ch);
		if (idx < 0) return null;
		num = num * 58n + BigInt(idx);
	}
	let hex = num.toString(16);
	if (hex.length % 2) hex = '0' + hex;
	let bytes = num === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex');
	let zeros = 0;
	while (zeros < text.length && text[zeros] === '1') zeros++;
	return Buffer.concat([Buffer.alloc(zeros), bytes]);
}

/**
 * Validate an address. Returns {address, version, hash160, type} or null.
 **/
function parseMinerAddress (address) {
	if (typeof address !== 'string' || address.length < 26 || address.length > 35) return null;
	let raw = base58Decode(address);
	if (!raw || raw.length !== 25) return null;
	let check = sha256d(raw.slice(0, 21)).slice(0, 4);
	if (!check.equals(raw.slice(21))) return null;
	let version = raw[0];
	if (version !== P2PKH_VERSION && version !== P2SH_VERSION) return null;
	return {address: address, version: version, hash160: raw.slice(1, 21), type: version === P2PKH_VERSION ? 'p2pkh' : 'p2sh'};
}
exports.parseMinerAddress = parseMinerAddress;

// scriptPubKey (hex) of a valid address: P2PKH = OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG, P2SH = OP_HASH160 <20> OP_EQUAL
exports.addressScript = function (address) {
	let parsed = parseMinerAddress(address);
	if (!parsed) return null;
	return parsed.type === 'p2pkh' ? '76a914' + parsed.hash160.toString('hex') + '88ac' : 'a914' + parsed.hash160.toString('hex') + '87';
};

// Validate miner address
exports.validateMinerAddress = function (address) {
	return parseMinerAddress(address) !== null;
}

// Canonical form of a valid address, or null
exports.canonicalMinerAddress = function (address) {
	let parsed = parseMinerAddress(address);
	return parsed ? parsed.address : null;
}

/**
 * Miner account. Kept for the code shared with the other pools of this family (Yenten has no deposit notes):
 * account = address, note = null.
 **/
function parseMinerAccount (input) {
	let parsed = parseMinerAddress(input);
	if (!parsed) return null;
	return {publicKey: parsed.address, domain: null, address: parsed.address, note: null, account: parsed.address};
}
exports.parseMinerAccount = parseMinerAccount;

exports.canonicalMinerAccount = function (input) {
	let parsed = parseMinerAccount(input);
	return parsed ? parsed.account : null;
}

// Split a stored account back into {address, note}
exports.splitMinerAccount = function (account) {
	return {address: account, note: null};
}

/**
 * Developer donation table of the config: blockUnlocker.donations = {"<Yenten address>": percent of the block reward}.
 * Returns {canonical account: percent} of the valid entries (percent above 0 up to 10); onInvalid(address) is called for the others.
 **/
exports.donationTable = function (unlockerConfig, onInvalid) {
	let table = {};
	let entries = (unlockerConfig && unlockerConfig.donations) || {};
	Object.keys(entries).forEach(function (address) {
		let account = exports.canonicalMinerAccount(address);
		let percent = parseFloat(entries[address]);
		if (!account || !(percent > 0) || percent > 10) {
			if (onInvalid) onInvalid(address);
			return;
		}
		table[account] = percent;
	});
	return table;
};

function characterCount (string, char) {
	let re = new RegExp(char, "gi")
	let matches = string.match(re)
	return matches === null ? 0 : matches.length;
}
exports.characterCount = characterCount;

exports.determineRewardData = (value) => {
	let calculatedData = {
		'address': value,
		'rewardType': 'prop'
	}
	if (/^solo:/i.test(value)) {
		calculatedData['address'] = value.substr(5)
		calculatedData['rewardType'] = 'solo'
		return calculatedData
	}
	if (/^prop:/i.test(value)) {
		calculatedData['address'] = value.substr(5)
		calculatedData['rewardType'] = 'prop'
		return calculatedData
	}
	return calculatedData
}

/**
 * Cleanup special characters (fix for non latin characters)
 **/
function cleanupSpecialChars (str) {
	str = str.replace(/[ÀÁÂÃÄÅ]/g, "A");
	str = str.replace(/[àáâãäå]/g, "a");
	str = str.replace(/[ÈÉÊË]/g, "E");
	str = str.replace(/[èéêë]/g, "e");
	str = str.replace(/[ÌÎÏ]/g, "I");
	str = str.replace(/[ìîï]/g, "i");
	str = str.replace(/[ÒÔÖ]/g, "O");
	str = str.replace(/[òôö]/g, "o");
	str = str.replace(/[ÙÛÜ]/g, "U");
	str = str.replace(/[ùûü]/g, "u");
	return str.replace(/[^A-Za-z0-9\-\_+]/gi, '');
}
exports.cleanupSpecialChars = cleanupSpecialChars;

/**
 * Get readable hashrate
 **/
exports.getReadableHashRate = function (hashrate) {
	let i = 0;
	let byteUnits = [' H', ' KH', ' MH', ' GH', ' TH', ' PH'];
	while (hashrate > 1000) {
		hashrate = hashrate / 1000;
		i++;
	}
	return hashrate.toFixed(2) + byteUnits[i] + '/sec';
}

/**
 * Get readable coins
 **/
exports.getReadableCoins = function (coins, digits, withoutSymbol) {
	let coinDecimalPlaces = config.coinDecimalPlaces || config.coinUnits.toString().length - 1;
	let amount = (parseInt(coins || 0) / config.coinUnits).toFixed(digits || coinDecimalPlaces);
	return amount + (withoutSymbol ? '' : (' ' + config.symbol));
}

/**
 * Generate unique id
 **/
exports.uid = function () {
	let min = 100000000000000;
	let max = 999999999999999;
	let id = Math.floor(Math.random() * (max - min + 1)) + min;
	return id.toString();
};

/**
 * Ring buffer
 **/
exports.ringBuffer = function (maxSize) {
	let data = [];
	let cursor = 0;
	let isFull = false;

	return {
		append: function (x) {
			if (isFull) {
				data[cursor] = x;
				cursor = (cursor + 1) % maxSize;
			} else {
				data.push(x);
				cursor++;
				if (data.length === maxSize) {
					cursor = 0;
					isFull = true;
				}
			}
		},
		avg: function (plusOne) {
			let sum = data.reduce(function (a, b) {
				return a + b
			}, plusOne || 0);
			return sum / ((isFull ? maxSize : cursor) + (plusOne ? 1 : 0));
		},
		size: function () {
			return isFull ? maxSize : cursor;
		},
		clear: function () {
			data = [];
			cursor = 0;
			isFull = false;
		}
	};
};
