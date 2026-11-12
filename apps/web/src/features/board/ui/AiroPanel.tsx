import type { Dispatch, RefObject, SetStateAction } from "react";
import type {
  ActiveSpeechSession,
  CameraStatus,
  CopilotActivityEntry,
  SpeechRecognitionStatus,
} from "../engine/boardTypes";
import { speechRecognitionLabel, truncateSpeechTranscript } from "./boardLabels";

export type AiroPanelProps = {
  copilotOpen: boolean;
  speechArmed: boolean;
  cameraStatus: CameraStatus;
  voiceDropped: boolean;
  airoBlockedByBrowser: boolean;
  airoNotAllowed: boolean;
  setCopilotVisibility: (visible: boolean) => void;
  speechHeardText: string;
  voiceOffReason: string | null;
  speechRecognitionStatus: SpeechRecognitionStatus;
  copilotActivity: CopilotActivityEntry[];
  commandFeedback: string;
  runIntentCommand: (text: string) => void;
  intentCommandText: string;
  intentCommandInputRef: RefObject<HTMLTextAreaElement | null>;
  semanticIntentRequestIdRef: RefObject<number>;
  setSpeechRecognitionStatus: Dispatch<SetStateAction<SpeechRecognitionStatus>>;
  speechSessionRef: RefObject<ActiveSpeechSession | null>;
  setIntentCommandText: Dispatch<SetStateAction<string>>;
};

/** Airo's side panel (what it heard, activity, typed commands), or its show button when hidden. */
export function AiroPanel({
  copilotOpen,
  speechArmed,
  cameraStatus,
  voiceDropped,
  airoBlockedByBrowser,
  airoNotAllowed,
  setCopilotVisibility,
  speechHeardText,
  voiceOffReason,
  speechRecognitionStatus,
  copilotActivity,
  commandFeedback,
  runIntentCommand,
  intentCommandText,
  intentCommandInputRef,
  semanticIntentRequestIdRef,
  setSpeechRecognitionStatus,
  speechSessionRef,
  setIntentCommandText,
}: AiroPanelProps) {
  return copilotOpen ? (
    <aside
      className="canvas-copilot"
      data-testid="canvas-copilot"
      aria-label="Airo copilot"
    >
      <header className="canvas-copilot-header">
        <div>
          <span className="canvas-copilot-orbit" aria-hidden="true">✦</span>
          <span>
            <strong>Airo</strong>
            <small>
              {speechArmed
                ? "Listening continuously"
                : cameraStatus === "active"
                  ? "Watching for your hands"
                  : cameraStatus === "starting" || cameraStatus === "tracker_loading"
                    ? "Starting voice and hands…"
                    : voiceDropped
                      ? "Voice paused"
                      : airoBlockedByBrowser
                      ? "Camera and microphone are blocked"
                      : airoNotAllowed
                        ? "Camera and microphone aren't allowed"
                        : cameraStatus === "error" || cameraStatus === "tracker_error"
                          ? "The camera couldn't start"
                          : "Type a command below"}
            </small>
          </span>
        </div>
        <div className="canvas-copilot-header-actions">
          <button
            type="button"
            aria-label="Hide Airo panel"
            title="Hide"
            onClick={() => setCopilotVisibility(false)}
          >
            ›
          </button>
        </div>
      </header>

      <>
          <section className="canvas-copilot-heard" data-testid="copilot-transcript">
            <span>What I heard</span>
            <p>
              {speechHeardText
                ? `“${truncateSpeechTranscript(speechHeardText, 180)}”`
                : speechArmed
                  ? "Listening for your next command…"
                  : voiceDropped
                    ? "Airo's voice paused. Hold an open palm, or click the board, to wake it."
                    : airoBlockedByBrowser
                      ? "Allow the camera and microphone for this site in your browser's settings, then reload the board."
                      : airoNotAllowed
                        ? "Reload the board to be asked again, or allow the camera and microphone in your browser's site settings."
                        : voiceOffReason
                          ? `Airo's voice is off: ${voiceOffReason}`
                          : cameraStatus === "error" || cameraStatus === "tracker_error"
                            ? "Close other apps using the camera, then come back to this tab to try again."
                            : cameraStatus === "active"
                              ? "Hold an open palm for 0.4 seconds and speak."
                              : "Type a command below."}
            </p>
            <small className={`copilot-status ${speechRecognitionStatus}`}>
              {speechRecognitionLabel(speechRecognitionStatus)}
            </small>
          </section>

          <section className="canvas-copilot-progress" aria-live="polite">
            <div className="canvas-copilot-section-title">
              <span>Activity</span>
              <small>What Airo is doing</small>
            </div>
            <ol data-testid="copilot-activity">
              {copilotActivity.map((entry) => (
                <li key={entry.id} className={entry.tone}>
                  <span className="copilot-activity-source">{entry.source}</span>
                  <div>
                    <strong>{entry.title}</strong>
                    <p>{entry.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="canvas-copilot-current">
            <span>Current status</span>
            <p
              id="canvas-command-feedback"
              className="intent-feedback"
            >
              {commandFeedback}
            </p>
          </section>
      </>

      <form
        className="canvas-copilot-composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (speechRecognitionStatus !== "interpreting") {
            runIntentCommand(intentCommandText);
          }
        }}
      >
        <label className="sr-only" htmlFor="canvas-command-input">
          Type a board command
        </label>
        <textarea
          id="canvas-command-input"
          ref={intentCommandInputRef}
          data-testid="intent-command-input"
          value={intentCommandText}
          rows={2}
          onChange={(event) => {
            semanticIntentRequestIdRef.current += 1;
            if (speechRecognitionStatus === "interpreting") {
              setSpeechRecognitionStatus(speechSessionRef.current ? "waiting" : "idle");
            }
            setIntentCommandText(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (
                intentCommandText.trim() &&
                speechRecognitionStatus !== "interpreting"
              ) {
                runIntentCommand(intentCommandText);
              }
            }
          }}
          placeholder="Type only when you want to…"
          aria-describedby="canvas-command-feedback"
        />
        <button
          className="primary"
          data-testid="intent-primary-action"
          type="submit"
          aria-label="Send typed command"
          disabled={!intentCommandText.trim() || speechRecognitionStatus === "interpreting"}
        >
          {speechRecognitionStatus === "interpreting" ? "…" : "↑"}
        </button>
      </form>
      <footer className="canvas-copilot-hint">
        <span><strong>Undo:</strong> the arrow at the bottom left, Cmd/Ctrl+Z, or say “Airo, undo”</span>
        <span>Shift+Enter for a new line</span>
      </footer>
    </aside>
  ) : (
    <button
      type="button"
      className="canvas-copilot-toggle"
      data-testid="canvas-copilot-toggle"
      aria-label="Show Airo panel"
      title="Show Airo"
      onClick={() => setCopilotVisibility(true)}
    >
      <span aria-hidden="true">✦</span>
      <span>Airo</span>
      {speechRecognitionStatus === "hearing" ||
      speechRecognitionStatus === "interpreting" ? (
        <i aria-hidden="true" />
      ) : null}
    </button>
  );
}
