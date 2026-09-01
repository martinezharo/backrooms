# Gameplay analytics

Backrooms uses Cloudflare Workers Analytics Engine to measure probable engaged
gameplay sessions. It is not an account system and it does not identify unique
people.

## What is collected

Telemetry starts only after a trusted player action enters the game. An
`engaged_session` is sent after at least 45 visible, active seconds and 5 m of
movement. Other events are sent once per game page load or progression:

- `game_started`
- `engaged_session`
- `level_reached`
- `death`
- `escape`

Each event contains the current depth, elapsed play time, and input mode
(`keyboard` or `touch`). The Worker adds Cloudflare's two-letter country code.
If Cloudflare does not provide a country, it records `XX`.

`depth` is a zero-based index into the game's shared floor order. Its accepted
range is derived from that order, currently `0` through `5`, so adding a floor
updates the game and Worker contract together.

The implementation deliberately sends no IP address, seed, save data,
fingerprint, client identifier, or persistent user identifier. The browser
also disables telemetry when Do Not Track or Global Privacy Control is enabled.

Players can opt out with `?telemetry=off`. The choice is stored locally for
future visits. `?telemetry=on` removes that opt-out for the current browser.

## Dataset schema

The binding in [`wrangler.jsonc`](../wrangler.jsonc) is `GAME_ANALYTICS`, backed
by the `backrooms_gameplay` dataset.

Each `writeDataPoint()` call uses the following ordered fields:

| Field | Meaning |
| --- | --- |
| `blob1` | Event name |
| `blob2` | Cloudflare country code |
| `blob3` | Input mode |
| `double1` | Event count (`1`) |
| `double2` | Depth |
| `double3` | Elapsed seconds |
| `index1` | `${country}:${event}` |
| `timestamp` | Cloudflare event timestamp |

Analytics Engine may sample high-volume data. Use `_sample_interval` when
aggregating counts, for example `SUM(_sample_interval * double1)`.

## Cloudflare setup

Enable Workers Analytics Engine for the Cloudflare account before deploying
this Worker. The binding is already defined in `wrangler.jsonc`; the
`backrooms_gameplay` dataset is created automatically on its first write, so
it does not need to be created manually.

The production Worker is deployed by Cloudflare Workers Builds from pushes to
`main`. The build command is `pnpm run build` and the deploy command is
`pnpm wrangler deploy`.

## Querying the data

Use the [Workers Analytics Engine SQL API](https://developers.cloudflare.com/analytics/analytics-engine/sql-api/).
Create a Cloudflare API token with the `Account Analytics Read` permission and
send SQL to:

```text
https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/analytics_engine/sql
```

For example, to see probable engaged sessions by country from the last seven
days:

```sql
SELECT
  blob2 AS country,
  SUM(_sample_interval * double1) AS engaged_sessions
FROM backrooms_gameplay
WHERE blob1 = 'engaged_session'
  AND timestamp > NOW() - INTERVAL '7' DAY
GROUP BY country
ORDER BY engaged_sessions DESC;
```

To see the event trend by day:

```sql
SELECT
  toDate(timestamp) AS day,
  blob1 AS event,
  SUM(_sample_interval * double1) AS occurrences
FROM backrooms_gameplay
WHERE timestamp > NOW() - INTERVAL '7' DAY
GROUP BY day, event
ORDER BY day DESC, occurrences DESC;
```

These are session and event counts, not unique-user counts, because no
identifier is stored.
