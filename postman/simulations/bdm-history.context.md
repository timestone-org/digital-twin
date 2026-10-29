# Simulation context — bdm-history

## Purpose

Run the real energy-source HTTP client and worker process against a local EMS
stand-in. `postman/mocks/bdm-history/default.js` follows the supplied
2026-10-27 hour/minute interface document; all identifiers and values are synthetic.

## Execution

From the repository root:

```sh
postman simulation run postman/simulations/bdm-history.sim.yaml --port 4920 --no-history --output ndjson > /tmp/bdm-history.ndjson 2> /tmp/bdm-history.err
# In a second terminal, after the listening event:
uv run --project server --package platform-server python postman/verify_bdm.py http://127.0.0.1:4920
```

Stop the simulation with Ctrl+C. Read the `request` events in the log to confirm
traffic reached the mock. The route key `api` preserves the client's fixed
`/api/bdm/training-data` path; the handler receives the remainder after `/api`.

## Assumptions

- 2026-10-28: Postman CLI 1.77.0 ran locally without login. The owner-mock search
  required authentication, so the supplied contract was used directly. Nothing
  was uploaded or deployed to Postman cloud.
- 2026-10-28: This exercises real HTTP, independent pagination, missing-value
  preservation, interval metadata checks, HTTP failure handling and the actual
  process pool. It does not establish field connectivity, EMS formula correctness,
  authentication against the real service or historical completeness.
- 2026-10-28: Only the hour/minute formula path is modeled here. Calendar behavior
  remains covered by the backend unit tests. Unsupported paths return 501.
- 2026-10-28: Restart the simulation after changing the handler; it does not reload.
  Only the chosen local port is called; this uses path routing, not a forward proxy.

## Observations

<!-- begin:observations -->
2026-10-28: The sole member, bdm-history, served catalog, indicator, point-history
and formula-history traffic. Verification passed with null preservation,
multiple pages per identifier, and explicit rejection of legacy metadata and 503.
<!-- end:observations -->
