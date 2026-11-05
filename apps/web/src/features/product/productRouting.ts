/** Routes that own the entire viewport and must not inherit product chrome. */
export function isImmersiveBoardPath(pathname: string): boolean {
  return pathname.startsWith("/app/boards/");
}
