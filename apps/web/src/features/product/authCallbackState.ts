export type AuthCallbackFailure = {
  title: string;
  detail: string;
  actionHref: string;
  actionLabel: string;
};

type SearchParamsLike = { get(name: string): string | null };

export function authCallbackFailure(params: SearchParamsLike): AuthCallbackFailure | null {
  const error = params.get("error");
  const code = params.get("error_code");
  if (!error && !code) return null;

  if (code === "otp_expired") {
    return {
      title: "This confirmation link has expired.",
      detail: "Email confirmation links are time-limited and can be used only once. Request a new secure link to continue.",
      actionHref: "/signup?reason=confirmation_link_expired",
      actionLabel: "Email me a new link",
    };
  }

  return {
    title: "Airboard could not confirm this sign-in.",
    detail: "The link may be invalid, already used, or opened from a different sign-in attempt. Request a fresh secure link and try again.",
    actionHref: "/login?reason=authentication_failed",
    actionLabel: "Request a new link",
  };
}
