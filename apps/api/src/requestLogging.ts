export function redactSensitiveRequestUrl(value: string): string {
  try {
    const url = new URL(value, "http://airboard.invalid");
    for (const key of [...url.searchParams.keys()]) {
      if (/ticket|token|secret|signature|credential|code|key/i.test(key)) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return value.replace(
      /([?&][^=&]*(?:ticket|token|secret|signature|credential|code|key)[^=&]*=)[^&]*/gi,
      "$1[REDACTED]",
    );
  }
}
