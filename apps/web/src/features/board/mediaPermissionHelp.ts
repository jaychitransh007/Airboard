/**
 * What to tell someone whose browser blocks the camera or microphone. Once a
 * site is blocked the browser never asks again, so "allow access" is not
 * enough: the person needs the exact control for their browser.
 */
export type BlockedMedia = "camera" | "microphone" | "camera and microphone";

type BrowserFamily = "chromium" | "safari" | "firefox" | "other";

export function browserFamily(userAgent: string): BrowserFamily {
  if (/Firefox\/|FxiOS\//.test(userAgent)) return "firefox";
  // Every iOS browser uses Safari's permission controls.
  if (/iPhone|iPad|iPod/.test(userAgent)) return "safari";
  if (/Chrome\/|Chromium\/|Edg\//.test(userAgent)) return "chromium";
  if (/Safari\//.test(userAgent)) return "safari";
  return "other";
}

export function blockedMediaHelp(blocked: BlockedMedia, userAgent: string): string {
  const setting = blocked === "camera and microphone" ? "Camera and Microphone" : blocked === "camera" ? "Camera" : "Microphone";
  const how = {
    chromium: `click the icon at the left of the address bar, turn ${setting} on, then try again`,
    safari: `open the aA or Safari menu, choose Settings for This Website, set ${setting} to Allow, then try again`,
    firefox: `click the crossed-out icon in the address bar, remove the block, then try again`,
    other: `allow the ${blocked} in this site's settings beside the address bar, then try again`,
  }[browserFamily(userAgent)];
  const meanwhile = blocked === "microphone" ? "You can still type commands." : "You can still draw and type commands.";
  return `Your browser is blocking the ${blocked}. To use it, ${how}. ${meanwhile}`;
}

/** Help for whichever inputs the browser reports as denied, or null. */
export function deniedMediaHelp(camera: string, microphone: string, userAgent: string): string | null {
  const blocked: BlockedMedia | null =
    camera === "denied" && microphone === "denied"
      ? "camera and microphone"
      : camera === "denied"
        ? "camera"
        : microphone === "denied"
          ? "microphone"
          : null;
  return blocked ? blockedMediaHelp(blocked, userAgent) : null;
}
