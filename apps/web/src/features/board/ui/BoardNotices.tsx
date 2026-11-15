import type {
  CameraStatus,
  ObjectGestureState,
  VoiceGateUi,
} from "../engine/boardTypes";
import type { UndoSource } from "../history/boardHistory";

export type BoardNoticesProps = {
  airoNotice: { id: number; tone: "warning" | "question"; detail: string } | null;
  undoToast: { id: number; detail: string } | null;
  undoLastAction: (source?: UndoSource) => void;
  voiceGate: VoiceGateUi | null;
  speechArmed: boolean;
  cameraStatus: CameraStatus;
  objectGestureState: ObjectGestureState;
  handCue: { id: number; text: string; x: number; y: number; tone: "info" | "warning" } | null;
  onboardingVisible: boolean;
  finishOnboarding: () => void;
};

/**
 * The on-board notices over the canvas: Airo's notice, the undo toast, the
 * voice and hand pills, the hand cue and the first-run card.
 */
export function BoardNotices({
  airoNotice,
  undoToast,
  undoLastAction,
  voiceGate,
  speechArmed,
  cameraStatus,
  objectGestureState,
  handCue,
  onboardingVisible,
  finishOnboarding,
}: BoardNoticesProps) {
  return (
    <>
      {airoNotice ? (
        <div
          className={`airo-notice ${airoNotice.tone}`}
          role="status"
          aria-live="polite"
          data-testid="airo-notice"
        >
          <span aria-hidden="true">{airoNotice.tone === "question" ? "?" : "!"}</span>
          <span className="airo-notice-detail">{airoNotice.detail}</span>
        </div>
      ) : null}
      {undoToast ? (
        <div className="undo-toast" role="status" aria-live="polite" data-testid="undo-toast">
          <span className="undo-toast-detail">{undoToast.detail}</span>
          <button type="button" onClick={() => undoLastAction("button")}>
            Undo
          </button>
        </div>
      ) : null}
      {voiceGate ? (
        <div
          className={`voice-gate-pill ${speechArmed ? "armed" : "unarmed"}`}
          role="status"
          data-testid="voice-gate-pill"
        >
          <span className="voice-gate-dot" aria-hidden="true" />
          {voiceGate.mode === "ptt"
            ? speechArmed
              ? "Listening — speak a board command"
              : "Open palm detected — Airo's voice is off"
            : speechArmed
              ? `Editing “${voiceGate.label}” — “rename to …”, “delete”, “connect to …”`
              : `Holding “${voiceGate.label}” — Airo's voice is off`}
        </div>
      ) : null}
      {cameraStatus === "active" &&
      objectGestureState !== "hover" &&
      objectGestureState !== "no target" ? (
        <div
          className={`object-gesture-pill ${voiceGate ? "with-voice" : ""}`}
          role="status"
          aria-live="polite"
        >
          {objectGestureState === "placing"
            ? "Placement locked — move, then reopen"
            : objectGestureState === "erase"
              ? "Erase locked — sweep, then reopen"
              : "Move locked — move, then reopen"}
        </div>
      ) : null}
      {handCue ? (
        <div
          key={handCue.id}
          className={`hand-cue ${handCue.tone}`}
          role="status"
          aria-live="polite"
          data-testid="hand-cue"
          style={{ left: handCue.x, top: handCue.y }}
        >
          {handCue.text}
        </div>
      ) : null}
      {onboardingVisible ? (
        // A corner card, not a dialog: the board stays usable behind it,
        // and it closes by itself after the first change.
        <aside className="onboarding-overlay" aria-label="Build by talking and pointing">
          <div className="onboarding-card">
            <h2>Build by talking and pointing</h2>
            <ol className="onboarding-commands">
              <li>Say <code>Airo, add a user</code>, or hold an open palm still and speak.</li>
              <li>
                Describe a flow: <code>Airo, users sign in through the auth service, which checks the user database</code>.
              </li>
              <li>Close your hand over a shape to move it; open it to drop.</li>
              <li>Changes apply at once. Say <code>Airo, undo</code> to take one back.</li>
            </ol>
            <p className="onboarding-aside">
              This card closes after your first change.{" "}
              <a href="/help/using-the-board/gestures" target="_blank" rel="noreferrer">
                All camera gestures
              </a>
            </p>
            <button type="button" className="secondary" onClick={finishOnboarding}>
              Got it
            </button>
          </div>
        </aside>
      ) : null}
    </>
  );
}
