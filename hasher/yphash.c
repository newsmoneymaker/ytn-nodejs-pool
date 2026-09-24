// yphash: share validation helper of the Yenten pool.
// Reads commands on stdin, writes answers on stdout (one line each):
//   H <id> <160 hex>    the 80 byte block header (version, previous hash, merkle root, time, bits, nonce, as serialized);
//                       answers "H <id> <64 hex>": the yespower hash, 32 bytes as computed (a little endian number), or "H <id> err"
//   Q                   quit
// The parameters are Yenten's (src/primitives/block.cpp GetPoWHash): blocks with a time after 1553904000 use yespower 1.0, N=4096, r=16, no
// personalization; older blocks use yespower 0.5, N=4096, r=16, personalization "Client Key". Command line: --hash <160 hex> prints the hash.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include "yespower/yespower.h"

static int hexval(int c)
{
	if (c >= '0' && c <= '9') return c - '0';
	if (c >= 'a' && c <= 'f') return c - 'a' + 10;
	if (c >= 'A' && c <= 'F') return c - 'A' + 10;
	return -1;
}

static int from_hex(const char *s, unsigned char *out, size_t n)
{
	if (strlen(s) != n * 2) return -1;
	for (size_t i = 0; i < n; i++) {
		int a = hexval(s[2 * i]), b = hexval(s[2 * i + 1]);
		if (a < 0 || b < 0) return -1;
		out[i] = (unsigned char)(a * 16 + b);
	}
	return 0;
}

static int hash80(const unsigned char *header, unsigned char *out)
{
	uint32_t t = (uint32_t)header[68] | ((uint32_t)header[69] << 8) | ((uint32_t)header[70] << 16) | ((uint32_t)header[71] << 24);
	yespower_params_t params;
	memset(&params, 0, sizeof(params));
	params.N = 4096;
	params.r = 16;
	if (t > 1553904000u) {
		params.version = YESPOWER_1_0;
		params.pers = NULL;
		params.perslen = 0;
	} else {
		params.version = YESPOWER_0_5;
		params.pers = (const uint8_t *)"Client Key";
		params.perslen = 10;
	}
	return yespower_tls(header, 80, &params, (yespower_binary_t *)out);
}

static void to_hex(const unsigned char *in, size_t n, char *out)
{
	static const char d[] = "0123456789abcdef";
	for (size_t i = 0; i < n; i++) { out[2 * i] = d[in[i] >> 4]; out[2 * i + 1] = d[in[i] & 15]; }
	out[2 * n] = 0;
}

int main(int argc, char **argv)
{
	unsigned char header[80], hash[32];
	char hex[65];

	if (argc == 3 && strcmp(argv[1], "--hash") == 0) {
		if (from_hex(argv[2], header, 80) || hash80(header, hash)) { fprintf(stderr, "need 160 hex chars\n"); return 1; }
		to_hex(hash, 32, hex);
		puts(hex);
		return 0;
	}

	char line[512];
	while (fgets(line, sizeof(line), stdin)) {
		if (line[0] == 'Q') break;
		if (line[0] != 'H') continue;
		char id[64], data[400];
		if (sscanf(line, "H %63s %399s", id, data) != 2 || from_hex(data, header, 80) || hash80(header, hash)) {
			printf("H %s err\n", (strlen(line) > 2) ? id : "0");
			fflush(stdout);
			continue;
		}
		to_hex(hash, 32, hex);
		printf("H %s %s\n", id, hex);
		fflush(stdout);
	}
	return 0;
}
