| case | engine | runs | req/s median | req/s spread | p50 ms | p99 ms |
|---|---|---|---|---|---|---|
| clear-delifeq | valkey-9.1.3 | 3 | 117509 | 105197-133298 | 0.367 | 0.911 |
| clear-lua | redis-7.4.12 | 3 | 85063 | 85034-90868 | 0.511 | 1.175 |
| clear-lua | valkey-9.1.3 | 3 | 83250 | 81579-83292 | 0.519 | 1.239 |
| limit-decrement-lua | redis-7.4.12 | 3 | 105230 | 105208-111049 | 0.391 | 0.927 |
| limit-decrement-lua | valkey-9.1.3 | 3 | 99970 | 88818-102543 | 0.439 | 0.991 |
| limit-increment-lua | redis-7.4.12 | 3 | 72685 | 72659-75228 | 0.591 | 1.479 |
| limit-increment-lua | valkey-9.1.3 | 3 | 75432 | 71393-83292 | 0.567 | 1.415 |
| refresh-lua | redis-7.4.12 | 3 | 85063 | 81593-90868 | 0.511 | 1.159 |
| refresh-lua | valkey-9.1.3 | 3 | 83292 | 78370-86911 | 0.519 | 1.255 |
| refresh-set-ifeq | valkey-9.1.3 | 3 | 107365 | 105219-108026 | 0.391 | 1.039 |
| xadd-nomkstream-maxlen | redis-7.4.12 | 3 | 83250 | 79962-85020 | 0.511 | 1.207 |
| xadd-nomkstream-maxlen | valkey-9.1.3 | 3 | 81599 | 76882-83285 | 0.535 | 1.127 |
| xadd-nomkstream-maxlen-at-cap | redis-7.4.12 | 3 | 86926 | 83285-88857 | 0.479 | 1.151 |
| xadd-nomkstream-maxlen-at-cap | valkey-9.1.3 | 3 | 85063 | 75936-88857 | 0.511 | 1.079 |
| xadd-nomkstream-maxlen-small | redis-7.4.12 | 3 | 108050 | 99910-117578 | 0.383 | 0.967 |
| xadd-nomkstream-maxlen-small | valkey-9.1.3 | 3 | 102375 | 99910-107643 | 0.423 | 0.951 |
| xread-count1 | redis-7.4.12 | 3 | 92963 | 88865-97494 | 0.447 | 1.159 |
| xread-count1 | valkey-9.1.3 | 3 | 90868 | 86904-95175 | 0.479 | 1.063 |
| xread-count100 | redis-7.4.12 | 3 | 5937 | 5788-6027 | 2.831 | 6.231 |
| xread-count100 | valkey-9.1.3 | 3 | 5674 | 5169-6063 | 2.999 | 7.743 |
