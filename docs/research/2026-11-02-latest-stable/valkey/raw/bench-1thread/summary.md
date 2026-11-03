| case | engine | runs | req/s median | req/s spread | p50 ms | p99 ms |
|---|---|---|---|---|---|---|
| clear-delifeq | valkey-9.1.3 | 3 | 97656 | 97371-107239 | 0.295 | 1.071 |
| clear-lua | redis-7.4.12 | 3 | 92807 | 86919-93240 | 0.431 | 0.903 |
| clear-lua | valkey-9.1.3 | 3 | 86281 | 82136-88613 | 0.399 | 1.015 |
| limit-decrement-lua | redis-7.4.12 | 3 | 94967 | 87108-95923 | 0.319 | 0.663 |
| limit-decrement-lua | valkey-9.1.3 | 3 | 92550 | 88261-92937 | 0.351 | 0.911 |
| limit-increment-lua | redis-7.4.12 | 3 | 74571 | 68190-80775 | 0.575 | 1.151 |
| limit-increment-lua | valkey-9.1.3 | 3 | 76278 | 60132-82747 | 0.423 | 1.535 |
| refresh-lua | redis-7.4.12 | 3 | 77670 | 73368-84818 | 0.519 | 1.063 |
| refresh-lua | valkey-9.1.3 | 3 | 81633 | 81004-85324 | 0.519 | 1.047 |
| refresh-set-ifeq | valkey-9.1.3 | 3 | 92851 | 91283-97182 | 0.343 | 0.759 |
| xadd-nomkstream-maxlen | redis-7.4.12 | 3 | 75075 | 52645-79460 | 0.575 | 0.967 |
| xadd-nomkstream-maxlen | valkey-9.1.3 | 3 | 80000 | 71048-82645 | 0.511 | 1.031 |
| xadd-nomkstream-maxlen-at-cap | redis-7.4.12 | 3 | 78034 | 76104-81400 | 0.519 | 0.975 |
| xadd-nomkstream-maxlen-at-cap | valkey-9.1.3 | 3 | 78431 | 77851-80321 | 0.519 | 0.975 |
| xadd-nomkstream-maxlen-small | redis-7.4.12 | 3 | 101471 | 82679-112867 | 0.351 | 0.711 |
| xadd-nomkstream-maxlen-small | valkey-9.1.3 | 3 | 95374 | 78555-100301 | 0.367 | 0.735 |
| xread-count1 | redis-7.4.12 | 3 | 89526 | 83472-99701 | 0.359 | 0.839 |
| xread-count1 | valkey-9.1.3 | 3 | 81800 | 74599-82781 | 0.375 | 0.807 |
| xread-count100 | redis-7.4.12 | 3 | 4471 | 4364-4591 | 1.287 | 5.839 |
| xread-count100 | valkey-9.1.3 | 3 | 4321 | 4160-4443 | 1.495 | 11.375 |
