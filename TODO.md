## Deferred Performance TODO

- Lower MysqlPanel `maxPoints` from 720 to 180~240 for clearer chart performance gains
- Switch metrics refresh from full-range polling to incremental fetch based on last timestamp
- Load lock waits and top slow queries on demand when tab is activated
- Add short-lived cache for identical metrics queries on backend (3~5 seconds)
