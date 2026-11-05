export type MediaPermissionKind = "camera" | "microphone";
export type MediaPermissionState = PermissionState | "unsupported";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type PermissionsLike = Pick<Permissions, "query">;

const MEDIA_RESUME_KEY_PREFIX = "airboard.media-resume.v1";

function mediaResumeKey(kind: MediaPermissionKind): string {
  return `${MEDIA_RESUME_KEY_PREFIX}.${kind}`;
}

export function mediaResumeEnabled(
  kind: MediaPermissionKind,
  storage: Pick<StorageLike, "getItem">,
): boolean {
  try {
    return storage.getItem(mediaResumeKey(kind)) === "enabled";
  } catch {
    return false;
  }
}

export function setMediaResumeEnabled(
  kind: MediaPermissionKind,
  enabled: boolean,
  storage: StorageLike,
): void {
  try {
    if (enabled) {
      storage.setItem(mediaResumeKey(kind), "enabled");
    } else {
      storage.removeItem(mediaResumeKey(kind));
    }
  } catch {
    // Private browsing and locked-down enterprise storage can reject writes.
  }
}

export async function queryMediaPermission(
  kind: MediaPermissionKind,
  permissions: PermissionsLike | undefined =
    typeof navigator === "undefined" ? undefined : navigator.permissions,
): Promise<MediaPermissionState> {
  if (!permissions?.query) return "unsupported";
  try {
    const status = await permissions.query(
      { name: kind } as unknown as PermissionDescriptor,
    );
    return status.state;
  } catch {
    // Safari and older Chromium versions may expose Permissions but not these
    // media descriptors. In that case we require an explicit user action.
    return "unsupported";
  }
}

export function shouldResumeMedia(
  permission: MediaPermissionState,
  resumeEnabled: boolean,
): boolean {
  return permission === "granted" && resumeEnabled;
}

export function mediaPermissionLabel(state: MediaPermissionState): string {
  if (state === "granted") return "Allowed";
  if (state === "denied") return "Blocked";
  if (state === "prompt") return "Ask once";
  return "Browser managed";
}
