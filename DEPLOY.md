# Deploying Glassfish Zero

One container, one volume. No database server, no native modules, no build
toolchain.

## The one constraint that matters

**Run exactly one instance.**

The database is SQLite on a mounted volume, and a volume attaches to a single
machine. A second replica would boot with its own empty database and serve a
different half of your traffic — ingest landing in one, the dashboard reading
the other. Every config in this repository pins the instance count to 1;
leave it there.

That is the right trade for this workload (one writer, many reads, modest
volume), but it is a real ceiling. If you outgrow it, the swap is Postgres,
and the surface to change is small — every query goes through one wrapper in
[`apps/web/src/lib/db.ts`](apps/web/src/lib/db.ts).

---

## Fly.io

```bash
fly launch --no-deploy --copy-config
fly volumes create glassfish_data --size 1 --region fra
fly deploy
fly secrets set GLASSFISH_PUBLIC_URL=https://<your-app>.fly.dev
```

[`fly.toml`](fly.toml) already declares the mount, the health check and
`min_machines_running = 1`. Keep `auto_stop_machines = "off"`: a suspended
machine cannot accept ingest, and the SDK would burn its three retries waiting
for a cold start — spans would be dropped, quietly.

Check it is on one machine: `fly status`. If it ever shows two, `fly scale count 1`.

## Render

Dashboard → **New** → **Blueprint** → point at this repository.
[`render.yaml`](render.yaml) declares the Docker build, the 1 GB disk at
`/data`, the health check and `numInstances: 1`.

Afterwards set `GLASSFISH_PUBLIC_URL` to the URL Render assigns.

## Railway

New project → **Deploy from GitHub repo**. [`railway.json`](railway.json) sets
the Dockerfile build, start command and health check.

**Add the volume by hand** — Railway has no file-based volume declaration:
service → **Variables / Volumes** → **New Volume**, mount path `/data`. Do
this *before* the first real traffic, because attaching a volume replaces
whatever was at that path.

---

## Environment

| Variable | Default | What it does |
|---|---|---|
| `GLASSFISH_DB` | `./data/glassfish.db` | Database path. Point it at the volume: `/data/glassfish.db`. |
| `GLASSFISH_PUBLIC_URL` | `http://localhost:3000` | Origin shown in the Settings tab's copy-paste snippet. Without it your users copy a localhost URL. |
| `GLASSFISH_ALLOW_SIGNUP` | unset | `1` re-opens registration. See below. |
| `PORT` | `3000` | Set by the platform. |

### Registration closes itself

On a public URL an open signup form is a stranger's way in. So it closes
automatically: accounts can be created only while the instance has **zero**
users. You register first, you become the owner, the form shuts.

The check is enforced in the server action as well as on the page, so a
hand-crafted POST does not get through a closed form. To deliberately re-open
it — adding a colleague — set `GLASSFISH_ALLOW_SIGNUP=1`, let them register,
then unset it.

There is no password reset flow. Losing the password means editing the
`users` row directly.

---

## First run

1. Open the deployed URL and register. This is the owner account.
2. Create a project. The API key is shown **once** — only a SHA-256 hash is
   stored, so it cannot be recovered. Losing it costs nothing but issuing a
   new one.
3. Put it in the application you want to observe:

   ```bash
   GLASSFISH_API_KEY=gfz_live_…
   GLASSFISH_BASE_URL=https://<your-deployment>
   ```

4. Confirm the instance is up before pointing production at it:

   ```bash
   curl https://<your-deployment>/api/v1/health
   # {"status":"ok","wireVersion":"v1","pricedModels":16,...}
   ```

5. On the **Prices** tab, confirm the rates for any non-Anthropic model you
   use. They ship as unverified placeholders and are flagged everywhere they
   contribute to a cost figure until you tick the confirmation box.

---

## Backups

The volume is the only copy of your data. Snapshot it:

```bash
npm run backup --workspace=@glassfish-zero/web -- --db /data/glassfish.db --out /data/backups
```

This uses `VACUUM INTO`, which writes a consistent snapshot while the server
keeps running, and prunes to the last 14 by default (`--keep N`).

**Do not back up with `cp glassfish.db`.** The database runs in WAL mode, so
recent writes live in the `glassfish.db-wal` sidecar; a plain file copy can
silently lose the last minutes of ingest and you will not find out until you
restore.

On Fly: `fly ssh console -C "node /app/apps/web/scripts/backup.mjs"`, then
`fly sftp get`. Fly also snapshots volumes daily on its own — that is a second
line of defence, not a substitute, because it restores a whole volume rather
than a file you can inspect.

---

## Operating notes

- **Ingest is the hot path.** `POST /api/v1/ingest` is authenticated by a
  SHA-256 key lookup and writes in one transaction. A batch is at most 1000
  spans; the SDK defaults to 25 per flush.
- **A restart loses at most one in-flight batch.** The SDK queues spans in
  memory and retries 5xx with backoff, so a short restart is absorbed. A long
  outage overflows the SDK's 10 000-span queue, and it drops from there —
  `gf.dropped` is non-zero when that happens, which is worth logging.
- **Disk growth.** Roughly a few hundred bytes per span, more if
  `capturePayloads` is on (it is off by default). 1 GB holds a long time at
  ordinary volume; watch it rather than assume it.
- **No retention policy ships.** Nothing deletes old spans yet. If you enable
  payload capture on high traffic, add a cron that prunes `spans` and
  re-rolls the affected traces.
- **HTTPS is the platform's job.** Session cookies are issued `secure` when
  `NODE_ENV=production`, so the dashboard will not keep you logged in over
  plain HTTP in production. That is deliberate.

---

## Building the image locally

```bash
docker build -t glassfish-zero .
docker run -p 3000:3000 -v glassfish-data:/data glassfish-zero
```

The build compiles the SDK and the dashboard, then ships only Next's
standalone output with a pruned `node_modules`.
