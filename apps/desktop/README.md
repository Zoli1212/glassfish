# Glassfish Zero — desktop

The dashboard and its database, running on your own machine. One installer,
no Docker, no server to operate, nothing leaves the laptop.

```bash
npm install
npm run dist --workspace=@glassfish-zero/desktop
# → apps/desktop/dist/GlassfishZero-Setup-0.2.0.exe
```

For a development run without packaging:

```bash
npm run start --workspace=@glassfish-zero/desktop
```

## How it works

The app is the **same** Next server the hosted build runs — there is no
desktop fork of the product. The Electron main process:

1. asks the OS for a free port,
2. starts the standalone server on `127.0.0.1` with that port,
3. waits for `/api/v1/health` to answer before showing a window,
4. points a `BrowserWindow` at it.

Because the server is unchanged, a trace recorded in the desktop app and one
recorded against a deployed instance are the same shape, priced by the same
engine, and the SDK talks to both identically.

## Where your data lives

```
%APPDATA%\Glassfish Zero\data\glassfish.db
```

**Not** in the install directory. Program Files is not writable by a normal
user, and an upgrade that replaces the install directory must not take your
cost history with it. *File → Open data folder* opens it.

Uninstalling leaves the database in place (`deleteAppDataOnUninstall: false`)
— removing an app should not silently destroy months of recorded spend. Delete
that folder by hand if you really want it gone.

Back it up with the same script the server build uses:

```bash
node apps/web/scripts/backup.mjs --db "%APPDATA%\Glassfish Zero\data\glassfish.db"
```

## Security choices

| Choice | Why |
|---|---|
| Listens on `127.0.0.1`, never `0.0.0.0` | A desktop install must not put your dashboard on the office network |
| Port chosen by the OS at launch | No fixed port for something else to collide with or squat on |
| `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` | The window only ever loads our own loopback server and has no need for Node |
| External links open in the real browser | A link can never navigate the app window away from the app |
| Single-instance lock | A second launch focuses the open window instead of starting a second server against the same database file |
| `GLASSFISH_ALLOW_SIGNUP=1` | A local install is single-user by definition; you can re-register if you forget the password, without the risk a public URL carries |

## Pointing your app at it

The desktop app picks a fresh port every launch, so there is no stable URL to
hard-code. *Help → About* shows the current one. For an application you are
instrumenting continuously, a deployed instance is the better target — the
desktop build is for working locally and for trying the thing out without
provisioning anything.

## The SmartScreen warning

The installer is **not code-signed**. Windows will show *"Windows protected
your PC"* on first run; **More info → Run anyway** gets past it.

That is not a bug to work around quietly — it is Windows correctly reporting
that nobody has vouched for this binary. Signing needs an Authenticode
certificate (a few hundred euro a year from a CA, or an EV token). Until
there is one, anyone you hand the installer to will see that dialog, and they
are right to be careful about it.
