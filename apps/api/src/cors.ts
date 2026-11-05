export const AIRBOARD_CORS_METHODS = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const;

// The web app calls the API from another origin with a bearer token, so every
// request needs a preflight. Without a max age Chrome rechecks after 5 seconds,
// adding a browser round trip in front of each call when a board opens.
export const AIRBOARD_CORS_MAX_AGE_SECONDS = 600;
