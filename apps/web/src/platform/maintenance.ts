/**
 * The API answers changes with 503 MAINTENANCE while Airboard is read-only
 * (for example while its database moves). airboardApi announces it with this
 * window event so the banner can appear on whatever page made the request.
 */
export const MAINTENANCE_EVENT = "airboard:maintenance";

export const MAINTENANCE_CODE = "MAINTENANCE";

export function announceMaintenance(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(MAINTENANCE_EVENT));
}
