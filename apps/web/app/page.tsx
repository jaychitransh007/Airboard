import { redirect } from "next/navigation";
import { HomeBoardSurface } from "../src/features/product/HomeBoardSurface";
import { LandingPage } from "../src/features/product/LandingPage";
import { authCallbackPathFromHome } from "../src/features/product/authCallbackState";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const authCallback = authCallbackPathFromHome(params);
  if (authCallback) redirect(authCallback);
  const testStandaloneValue = params.testStandalone;
  const testStandalone =
    process.env.NEXT_PUBLIC_AIRBOARD_TEST_HOOKS === "1" &&
    (Array.isArray(testStandaloneValue)
      ? testStandaloneValue.includes("1")
      : testStandaloneValue === "1");
  return testStandalone ? <HomeBoardSurface /> : <LandingPage />;
}
