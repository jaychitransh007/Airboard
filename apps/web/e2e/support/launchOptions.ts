/**
 * Launch options for specs that need their own browser flags. A spec's
 * launchOptions replace the config's, so this keeps the browser the release
 * matrix chose with AIRBOARD_E2E_EXECUTABLE (see playwright.config.ts).
 */
export function launchOptionsWith(args: string[]) {
  const executablePath = process.env.AIRBOARD_E2E_EXECUTABLE;
  return { args, ...(executablePath ? { executablePath } : {}) };
}
