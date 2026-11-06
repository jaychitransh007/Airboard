export const AUTO_UPDATE_ENV = "AIRBOARD_DESKTOP_AUTO_UPDATE";
export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * Whether this copy of the app should look for updates. Only installed
 * builds on macOS and Windows have an update feed; development runs and the
 * smoke test never update, and AIRBOARD_DESKTOP_AUTO_UPDATE=off turns it off.
 */
export function autoUpdatePolicy({ isPackaged, argv = [], env = {}, platform }) {
  if (!isPackaged) {
    return { enabled: false, reason: "development build" };
  }
  if (argv.includes("--smoke-test")) {
    return { enabled: false, reason: "smoke test" };
  }
  if (/^(0|false|off|no)$/i.test(String(env[AUTO_UPDATE_ENV] ?? "").trim())) {
    return { enabled: false, reason: `${AUTO_UPDATE_ENV} is off` };
  }
  if (platform !== "darwin" && platform !== "win32") {
    return { enabled: false, reason: `no update feed for ${platform}` };
  }
  return { enabled: true, reason: "installed build" };
}

function describe(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Checks now and every few hours, downloads in the background and installs
 * when the person quits. A failed check is logged and retried on the next
 * interval; it never reaches the person as a crash. Returns a stop function.
 */
export function startAutoUpdates({
  updater,
  policy,
  log,
  intervalMs = UPDATE_CHECK_INTERVAL_MS,
  schedule = setInterval,
  cancel = clearInterval,
}) {
  if (!policy.enabled) {
    log.info(`Automatic updates are off: ${policy.reason}.`);
    return () => {};
  }
  updater.logger = log;
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  // Without an error listener the updater's EventEmitter would throw.
  updater.on("error", (error) => log.warn(`Update failed: ${describe(error)}`));
  updater.on("update-downloaded", (info) =>
    log.info(`Airboard ${info?.version ?? "update"} is ready and installs when you quit.`),
  );

  const check = () => {
    try {
      Promise.resolve(updater.checkForUpdates()).catch((error) =>
        log.warn(`Update check failed: ${describe(error)}`),
      );
    } catch (error) {
      log.warn(`Update check failed: ${describe(error)}`);
    }
  };
  check();
  const timer = schedule(check, intervalMs);
  timer?.unref?.();
  return () => cancel(timer);
}

/** A logger that writes to the console and appends to a file, never throwing. */
export function createUpdateLog({ filePath, appendFile, now = () => new Date() }) {
  const write = (level, message) => {
    const line = `${now().toISOString()} ${level} ${message}`;
    (level === "WARN" || level === "ERROR" ? console.warn : console.log)(`[updates] ${line}`);
    if (filePath && appendFile) {
      Promise.resolve()
        .then(() => appendFile(filePath, `${line}\n`))
        .catch(() => {});
    }
  };
  return {
    info: (message) => write("INFO", message),
    warn: (message) => write("WARN", message),
    error: (message) => write("ERROR", message),
    debug: () => {},
  };
}
