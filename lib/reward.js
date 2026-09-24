/**
 * Block reward of Yenten mainnet: 50 YTN, halved every 800000 blocks (GetBlockSubsidy of the node, computed from the height of the block itself).
 * Amounts in atomic units (1 YTN = 1e8). The fees of the transactions come on top: the pool reads the exact reward of its own blocks from its wallet.
 **/
const YTN_BASE = 100000000;
const HALVING_INTERVAL = 800000;

exports.minerReward = function (height) {
	if (!(height >= 0)) return 0;
	let halvings = Math.floor(height / HALVING_INTERVAL);
	if (halvings >= 64) return 0;
	let subsidy = Math.floor(50 * YTN_BASE / Math.pow(2, halvings));
	// since height 2029999 10 % of the subsidy goes to the community autonomous address inside the coinbase
	return height >= 2029999 ? subsidy - Math.floor(subsidy * 10 / 100) : subsidy;
};
