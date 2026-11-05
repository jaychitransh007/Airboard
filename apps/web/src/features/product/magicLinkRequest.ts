export const PILOT_SUPPORT_EMAIL = "hellosigmascience@gmail.com";

/** Matches Supabase Auth's per-address cooldown between sign-in emails. */
export const MAGIC_LINK_RESEND_SECONDS = 60;

/**
 * Turns a failed sign-in email request into a sentence a person can act on.
 * Supabase Auth errors carry a stable `code`; its raw messages ("Email address
 * not authorized", "email rate limit exceeded") are not meant for end users.
 */
export function magicLinkFailureMessage(error: unknown): string {
  const failure = (typeof error === "object" && error !== null ? error : {}) as {
    code?: unknown;
    status?: unknown;
    message?: unknown;
    name?: unknown;
  };
  const code = typeof failure.code === "string" ? failure.code : "";
  const message = typeof failure.message === "string" ? failure.message : "";

  if (code === "email_address_not_authorized") {
    return `We couldn't email a sign-in link to this address yet. Airboard is in a limited pilot—write to ${PILOT_SUPPORT_EMAIL} and we'll get you set up.`;
  }
  if (code === "email_address_invalid") {
    return "That email address doesn't look right. Check it and try again.";
  }
  if (code === "signup_disabled" || code === "otp_disabled") {
    return `New sign-ups are paused right now. Write to ${PILOT_SUPPORT_EMAIL} to request access.`;
  }
  if (
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    failure.status === 429
  ) {
    const seconds = /after (\d+) seconds?/i.exec(message)?.[1];
    return seconds
      ? `Please wait ${seconds} seconds before asking for another link.`
      : "Too many sign-in emails were requested just now. Wait a minute and try again.";
  }
  if (failure.name === "TypeError" || /failed to fetch|network/i.test(message)) {
    return "We couldn't reach the sign-in service. Check your connection and try again.";
  }
  return "We couldn't send the sign-in link. Try again in a moment.";
}
