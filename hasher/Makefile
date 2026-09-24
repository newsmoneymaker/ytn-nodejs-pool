# yphash: the yespower sources of Yenten's node are in yespower/ (BSD licence, see the headers), nothing else is needed.
#   make            (STATIC=-static makes a binary that runs on any Linux)
CC ?= gcc
STATIC ?=
yphash: yphash.c yespower/yespower-opt.c yespower/sha256.c
	$(CC) -O2 -fomit-frame-pointer $(STATIC) -o $@ yphash.c yespower/yespower-opt.c yespower/sha256.c -I. -Iyespower
clean:
	rm -f yphash
