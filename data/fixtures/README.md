# Replay fixtures

`replay-cache.json` contains reviewed responses bound to the exact SHA-256 of the committed public
development bundle. It demonstrates two authority-boundary outcomes without a network call:

- one delimiter-formatted UTR span passes every deterministic test and may add a candidate edge;
- one convincing delayed-credit span fails the posting-window test and is rejected.

The response never contains a final status or money calculation. A cache miss or malformed entry
degrades safely to deterministic-only behavior and emits a warning.
