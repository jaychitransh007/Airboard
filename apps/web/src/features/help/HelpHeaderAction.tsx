"use client";

import Link from "next/link";
import { useAirboardAuth } from "../../platform/auth";

export function HelpHeaderAction() {
  const auth = useAirboardAuth();
  return (
    <Link className="button button-primary" href={auth.accessToken ? "/app" : "/login?next=/help"}>
      {auth.accessToken ? "Back to Airboard" : "Sign in"}
    </Link>
  );
}
