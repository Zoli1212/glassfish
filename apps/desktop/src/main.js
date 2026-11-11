'use strict';

const { app, BrowserWindow, Menu, dialog, shell, utilityProcess } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');

/**
 * Glassfish Zero desktop.
 *
 * The dashboard is the same Next server the hosted build runs; this process
 * starts it on a loopback port and points a window at it. Nothing about the
 * product forks for desktop — one codebase, one set of behaviours.
 */

// Electron derives the user-data directory from package.json's `name`, which
// here is the scoped workspace name — it would put the database in
// %APPDATA%\@glassfish-zero\desktop. Set the display name before anything
// reads a path, so data lands somewhere a person would think to look.
app.setName('Glassfish Zero');

const isDev = !app.isPackaged;
let serverProcess = null;
let mainWindow = null;
let serverUrl = null;

/** Where the Next standalone bundle lives, packaged or in the repo. */
function serverRoot() {
  return isDev
    ? path.join(__dirname, '..', 'server')
    : path.join(process.resourcesPath, 'server');
}

/**
 * The database lives in the OS's per-user application-data directory, not
 * beside the executable. Program Files is not writable by a normal user, and
 * an upgrade that replaces the install directory must not take the user's
 * cost history with it.
 */
function databasePath() {
  const dir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'glassfish.db');
}

/** Ask the OS for a free port rather than guessing one that may be taken. */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    // Loopback only: a desktop install must not expose the dashboard to the
    // local network, where it would be reachable without authentication
    // prompts anyone expects.
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const response = await fetch(`${url}/api/v1/health`);
        if (response.ok) return resolve();
      } catch {
        // not up yet
      }
      if (Date.now() > deadline) {
        return reject(new Error(`the dashboard did not start within ${timeoutMs / 1000}s`));
      }
      setTimeout(attempt, 300);
    };
    attempt();
  });
}

async function startServer() {
  const root = serverRoot();
  const entry = path.join(root, 'apps', 'web', 'server.js');

  if (!fs.existsSync(entry)) {
    throw new Error(
      `the bundled dashboard is missing (${entry}).\n\n` +
        'If you are running from a checkout, build it first:\n' +
        '  npm run prepare-server --workspace=@glassfish-zero/desktop',
    );
  }

  const port = await findFreePort();
  const url = `http://127.0.0.1:${port}`;

  serverProcess = utilityProcess.fork(entry, [], {
    cwd: root,
    stdio: 'pipe',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      GLASSFISH_DB: databasePath(),
      GLASSFISH_PUBLIC_URL: url,
      // A desktop install is single-user by definition; leaving signup open
      // lets the owner re-register if they forget their password, without
      // the risk a public URL carries.
      GLASSFISH_ALLOW_SIGNUP: '1',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  });

  serverProcess.stdout?.on('data', (chunk) => process.stdout.write(`[dashboard] ${chunk}`));
  serverProcess.stderr?.on('data', (chunk) => process.stderr.write(`[dashboard] ${chunk}`));

  serverProcess.on('exit', (code) => {
    serverProcess = null;
    // A crash after the window is up would otherwise leave a blank frame with
    // no explanation of what happened.
    if (code !== 0 && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox(
        'Glassfish Zero stopped',
        `The dashboard process exited with code ${code}. Your data is safe at:\n\n${databasePath()}\n\nRestart the app to continue.`,
      );
    }
  });

  await waitForServer(url);
  serverUrl = url;
  return url;
}

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open data folder',
          click: () => shell.showItemInFolder(databasePath()),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Documentation',
          click: () => shell.openExternal('https://github.com/Zoli1212/glassfish'),
        },
        {
          label: 'About',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Glassfish Zero',
              message: `Glassfish Zero ${app.getVersion()}`,
              detail: [
                'Self-hosted LLM observability.',
                '',
                `Dashboard: ${serverUrl ?? 'starting…'}`,
                `Database:  ${databasePath()}`,
                '',
                'The dashboard listens on loopback only — nothing is exposed to your network.',
              ].join('\n'),
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#0d0d0d',
    title: 'Glassfish Zero',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      // The window only ever loads our own loopback server, and the page has
      // no need for Node. Keeping the renderer sandboxed means a dependency
      // with a DOM-side flaw cannot reach the filesystem.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Anything that is not our dashboard opens in the real browser, so a link
  // can never navigate the app window away from the app.
  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith(url)) {
      event.preventDefault();
      shell.openExternal(target);
    }
  });

  mainWindow.loadURL(url);
}

// A second launch focuses the running window instead of starting a second
// server against the same database file.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    buildMenu();
    try {
      const url = await startServer();
      createWindow(url);
    } catch (error) {
      dialog.showErrorBox(
        'Glassfish Zero could not start',
        error instanceof Error ? error.message : String(error),
      );
      app.quit();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && serverUrl) createWindow(serverUrl);
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    // SQLite is mid-write often enough that an orphaned server process would
    // keep a lock on the database and block the next launch.
    if (serverProcess) {
      serverProcess.kill();
      serverProcess = null;
    }
  });
}
