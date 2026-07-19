import { AuthGate } from "../../src/platform/auth";
import { OnboardingFlow } from "../../src/features/product/OnboardingFlow";
export default function OnboardingPage() { return <AuthGate><OnboardingFlow /></AuthGate>; }
