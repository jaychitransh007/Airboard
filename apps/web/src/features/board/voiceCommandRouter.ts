// The .ts extension keeps this module directly runnable under Node's type
// stripping (unit tests, eval scripts) while the bundler resolves it the same.
import {
  classifyBrowserWakeTranscript,
  createBrowserWakeCommandRouter,
  normalizeScopedVoiceUtterance,
  type BrowserWakeCommandRouter,
} from "./browserSpeech.ts";

/**
 * The single owner of "does this finalized transcript become a board command,
 * and through which channel?". Three channels exist, in priority order:
 *
 *   1. gated-scoped — a hold-to-edit gate is scoping an element,
 *   2. gated-ptt    — a push-to-talk palm gate is open,
 *   3. wake         — the "Airo …" wake-word router.
 *
 * Everything that used to make this fragile is centralized here: gate grace
 * windows (a transcript may finalize just after the gesture releases),
 * single-consumption of grace-window gates, expiry, and — critically — the
 * dedup invariant: **one transcript can produce at most one routed command**,
 * even when a gate and the wake router would both claim it, and even when a
 * speech engine wake-routes internally (browser fallback). The class is pure
 * over an injectable clock, so every rule is unit-testable.
 */

export type VoiceGateMode = "ptt" | "scoped";

export type VoiceGateSnapshot = {
  mode: VoiceGateMode;
  strokeId?: string;
  /** False while the gate is in its post-release grace window. */
  open: boolean;
} | null;

export type VoiceRouteChannel = "gated-scoped" | "gated-ptt" | "wake";

export type VoiceRouteDecision = {
  channel: VoiceRouteChannel;
  /** The command text to execute (wake-stripped, scope-normalized). */
  command: string;
  /** The raw transcript the decision came from. */
  transcript: string;
  /** Provenance label for traces: gesture name or the actual wake phrase. */
  wakePhrase: string;
  /** Set for scoped decisions: the element the gate was scoping. */
  strokeId?: string;
};

export type VoiceCommandRouterConfig = {
  now?: () => number;
  /** Post-release routing grace for push-to-talk. */
  pttGraceMs?: number;
  /** Post-release routing grace for hold-to-edit ("grab, let go, speak"). */
  scopedGraceMs?: number;
  /** How long a gate's claim on a transcript blocks re-routing of it. */
  claimWindowMs?: number;
  /** Maximum time an utterance that began inside a gate may take to finalize. */
  utteranceClaimMs?: number;
};

type GateState = {
  mode: VoiceGateMode;
  strokeId?: string;
  openedAt: number;
  closedAt: number | null;
};

export class VoiceCommandRouter {
  private readonly now: () => number;
  private readonly pttGraceMs: number;
  private readonly scopedGraceMs: number;
  private readonly claimWindowMs: number;
  private readonly utteranceClaimMs: number;
  private readonly wakeRouter: BrowserWakeCommandRouter;

  private gate: GateState | null = null;
  private utteranceGate: { gate: GateState; capturedAt: number } | null = null;
  private claims: { transcript: string; at: number }[] = [];
  private collectingWake: VoiceRouteDecision[] | null = null;

  constructor(config: VoiceCommandRouterConfig = {}) {
    this.now = config.now ?? (() => Date.now());
    this.pttGraceMs = config.pttGraceMs ?? 1_600;
    this.scopedGraceMs = config.scopedGraceMs ?? 8_000;
    this.claimWindowMs = config.claimWindowMs ?? 5_000;
    this.utteranceClaimMs = config.utteranceClaimMs ?? 15_000;
    this.wakeRouter = createBrowserWakeCommandRouter(
      {
        onCommand: ({ command, transcript, wakePhrase }) => {
          this.collectingWake?.push({
            channel: "wake",
            command,
            transcript,
            wakePhrase,
          });
        },
      },
      { now: () => this.now() },
    );
  }

  /**
   * Claims the in-progress speech turn for the current gesture gate.
   *
   * Speech providers often emit the final transcript several seconds after
   * the user has lowered their palm. Capturing the gate on the first interim
   * result keeps that same utterance automatic without extending the general
   * post-gesture grace window for unrelated room speech.
   */
  noteSpeechActivity(): void {
    this.expire();
    if (!this.gate || this.utteranceGate) {
      return;
    }
    this.utteranceGate = {
      gate: { ...this.gate },
      capturedAt: this.now(),
    };
  }

  get snapshot(): VoiceGateSnapshot {
    if (!this.gate) {
      return null;
    }
    return {
      mode: this.gate.mode,
      ...(this.gate.strokeId !== undefined ? { strokeId: this.gate.strokeId } : {}),
      open: this.gate.closedAt === null,
    };
  }

  openGate(gate: { mode: VoiceGateMode; strokeId?: string }): VoiceGateSnapshot {
    this.gate = {
      mode: gate.mode,
      ...(gate.strokeId !== undefined ? { strokeId: gate.strokeId } : {}),
      openedAt: this.now(),
      closedAt: null,
    };
    return this.snapshot;
  }

  closeGate(mode: VoiceGateMode): void {
    if (this.gate && this.gate.mode === mode && this.gate.closedAt === null) {
      this.gate.closedAt = this.now();
    }
  }

  /** Drops a grace-lapsed gate. Returns true when the gate was removed. */
  expire(): boolean {
    if (!this.gate || this.gate.closedAt === null) {
      return false;
    }
    const grace = this.gate.mode === "scoped" ? this.scopedGraceMs : this.pttGraceMs;
    if (this.now() - this.gate.closedAt > grace) {
      this.gate = null;
      return true;
    }
    return false;
  }

  /**
   * Full routing for engines that do not wake-route internally (realtime
   * transcription, test hooks). Gates outrank the wake router; when a gate
   * claims the transcript the wake router never sees it.
   */
  handleFinalTranscript(transcript: string): {
    decisions: VoiceRouteDecision[];
    wakeDetected: boolean;
  } {
    const gated = this.routeGatedOnly(transcript);
    if (gated) {
      return { decisions: [gated], wakeDetected: false };
    }
    const decisions: VoiceRouteDecision[] = [];
    this.collectingWake = decisions;
    try {
      this.wakeRouter.consumeFinalTranscript(transcript);
    } finally {
      this.collectingWake = null;
    }
    return {
      decisions,
      wakeDetected: classifyBrowserWakeTranscript(transcript).wakeDetected,
    };
  }

  /**
   * Gate-only routing for the browser-fallback engine, whose session runs its
   * own internal wake router. Claiming here is what makes the later
   * internally-routed command for the same transcript deduplicate.
   */
  routeGatedOnly(transcript: string): VoiceRouteDecision | null {
    this.expire();
    const now = this.now();
    const captured =
      this.utteranceGate && now - this.utteranceGate.capturedAt <= this.utteranceClaimMs
        ? this.utteranceGate.gate
        : null;
    this.utteranceGate = null;
    const gate = captured ?? this.gate;
    if (!gate) {
      return null;
    }

    // A gated utterance may still carry a habitual "Airo" prefix — use the
    // wake classifier to strip it rather than parsing the wake word as text.
    const classification = classifyBrowserWakeTranscript(transcript);
    let command = classification.commands[0]?.command ?? transcript;
    if (gate.mode === "scoped") {
      command = normalizeScopedVoiceUtterance(command);
    }
    if (captured || gate.closedAt !== null) {
      // A grace-window gate routes exactly one utterance.
      this.gate = null;
    }
    this.claim(transcript);
    const decision: VoiceRouteDecision = {
      channel: gate.mode === "scoped" ? "gated-scoped" : "gated-ptt",
      command,
      transcript,
      wakePhrase: gate.mode === "scoped" ? "hold-to-edit" : "push-to-talk",
    };
    if (gate.strokeId !== undefined) {
      decision.strokeId = gate.strokeId;
    }
    return decision;
  }

  /**
   * Dedup guard for commands wake-routed inside a speech session. Returns
   * null when a gate already claimed this transcript — the invariant that a
   * transcript never executes twice is enforced here, not by callback
   * ordering in the UI layer.
   */
  acceptExternalWakeCommand(event: {
    transcript: string;
    command: string;
    wakePhrase: string;
  }): VoiceRouteDecision | null {
    if (this.isClaimed(event.transcript)) {
      return null;
    }
    return {
      channel: "wake",
      command: event.command,
      transcript: event.transcript,
      wakePhrase: event.wakePhrase,
    };
  }

  /** Session teardown: forget wake carryover, gates, and claims. */
  reset(): void {
    this.wakeRouter.reset();
    this.gate = null;
    this.utteranceGate = null;
    this.claims = [];
  }

  private claim(transcript: string): void {
    const now = this.now();
    this.claims = this.claims.filter((c) => now - c.at <= this.claimWindowMs);
    this.claims.push({ transcript, at: now });
  }

  private isClaimed(transcript: string): boolean {
    const now = this.now();
    return this.claims.some(
      (c) => c.transcript === transcript && now - c.at <= this.claimWindowMs,
    );
  }
}
