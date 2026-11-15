import type { Dispatch, RefObject, SetStateAction } from "react";
import { setAiroSoundsEnabled } from "../airoCues";
import {
  cameraCanvasScrim,
  MIN_CAMERA_PRESENTATION_SCRIM,
  screenFriendlyScrim,
} from "../lightboardComposition";
import { deniedMediaHelp } from "../mediaPermissionHelp";
import { mediaPermissionLabel, type MediaPermissionState } from "../mediaPermissionPreference";
import {
  CAMERA_PROMPT_HINT,
  type CameraStatus,
  type ScreenUnderlayStatus,
} from "../engine/boardTypes";
import { formatRecordingClock, screenUnderlayStatusLabel } from "./boardLabels";

export type BoardSettingsDrawerProps = {
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  microphonePermission: MediaPermissionState;
  cameraPermission: MediaPermissionState;
  cameraPromptWaiting: boolean;
  boardTheme: "classic" | "lightboard";
  cameraCanvasLocked: boolean;
  screenUnderlayStatus: ScreenUnderlayStatus;
  stopScreenUnderlay: (notice?: string | null) => void;
  setBoardTheme: Dispatch<SetStateAction<"classic" | "lightboard">>;
  airoSounds: boolean;
  setAiroSounds: Dispatch<SetStateAction<boolean>>;
  cameraUnderlayEnabled: boolean;
  cameraStatus: CameraStatus;
  setCameraUnderlayEnabled: Dispatch<SetStateAction<boolean>>;
  localContrastPlatesEnabled: boolean;
  setLocalContrastPlatesEnabled: Dispatch<SetStateAction<boolean>>;
  scrimOpacity: number;
  scrimOpacityRef: RefObject<number>;
  setScrimOpacity: Dispatch<SetStateAction<number>>;
  screenUnderlayNotice: string | null;
  recordingState: "idle" | "recording";
  stopStudioRecording: () => Promise<void>;
  startStudioRecording: () => Promise<void>;
  recordingSeconds: number;
  recordingNotice: string | null;
  confidenceThreshold: number;
  setConfidenceThreshold: Dispatch<SetStateAction<number>>;
  pendingCameraConfidenceRestartRef: RefObject<boolean>;
  stopCamera: () => void;
  autoSnapConnectors: boolean;
  setAutoSnapConnectors: Dispatch<SetStateAction<boolean>>;
};

/** The board settings drawer: media permissions, appearance, studio, input controls and shortcuts. */
export function BoardSettingsDrawer({
  setSettingsOpen,
  microphonePermission,
  cameraPermission,
  cameraPromptWaiting,
  boardTheme,
  cameraCanvasLocked,
  screenUnderlayStatus,
  stopScreenUnderlay,
  setBoardTheme,
  airoSounds,
  setAiroSounds,
  cameraUnderlayEnabled,
  cameraStatus,
  setCameraUnderlayEnabled,
  localContrastPlatesEnabled,
  setLocalContrastPlatesEnabled,
  scrimOpacity,
  scrimOpacityRef,
  setScrimOpacity,
  screenUnderlayNotice,
  recordingState,
  stopStudioRecording,
  startStudioRecording,
  recordingSeconds,
  recordingNotice,
  confidenceThreshold,
  setConfidenceThreshold,
  pendingCameraConfidenceRestartRef,
  stopCamera,
  autoSnapConnectors,
  setAutoSnapConnectors,
}: BoardSettingsDrawerProps) {
  return (
    <aside id="canvas-settings" className="sidebar canvas-inspector open">
      <div className="canvas-inspector-heading">
        <div>
          <span>Board</span>
          <h2>Settings</h2>
        </div>
        <button
          type="button"
          aria-label="Close board settings"
          onClick={() => setSettingsOpen(false)}
        >
          ×
        </button>
      </div>
      <section className="section media-permission-section">
        <div className="section-heading-inline">
          <div>
            <h2>Camera & microphone</h2>
            <p>Airboard asks for both when a board opens, then reuses them on every Airboard.</p>
          </div>
        </div>
        <div className="media-permission-row">
          <span className="media-permission-icon" aria-hidden="true">◉</span>
          <div>
            <strong>Microphone</strong>
            <small>Airo voice commands</small>
          </div>
          <span className={`permission-state ${microphonePermission}`}>
            {mediaPermissionLabel(microphonePermission)}
          </span>
        </div>
        <div className="media-permission-row">
          <span className="media-permission-icon" aria-hidden="true">◎</span>
          <div>
            <strong>Camera</strong>
            <small>Hands and presenter view</small>
          </div>
          <span className={`permission-state ${cameraPermission}`}>
            {mediaPermissionLabel(cameraPermission)}
          </span>
        </div>
        {cameraPromptWaiting ? (
          <p className="permission-warning" role="status">{CAMERA_PROMPT_HINT}</p>
        ) : null}
        <p className="permission-note">
          Choose <strong>Allow while visiting the site</strong> in the browser prompt, so
          Airboard doesn&apos;t ask again. To keep the camera or microphone off on every
          board, turn it off in Settings → Preferences. Screen sharing is still chosen each
          time.
        </p>
        {deniedMediaHelp(cameraPermission, microphonePermission, navigator.userAgent) ? (
          <p className="permission-warning">
            {deniedMediaHelp(cameraPermission, microphonePermission, navigator.userAgent)}
          </p>
        ) : null}
      </section>

      <section className="section">
        <h2>Appearance</h2>
        <label className="check-row" htmlFor="lightboard-theme">
          <input
            id="lightboard-theme"
            type="checkbox"
            checked={boardTheme === "lightboard"}
            disabled={cameraCanvasLocked}
            onChange={(event) => {
              const nextTheme = event.target.checked ? "lightboard" : "classic";
              if (nextTheme === "classic" && cameraCanvasLocked) {
                return;
              }
              if (nextTheme === "classic" && screenUnderlayStatus === "active") {
                stopScreenUnderlay("Screen background stopped because Lightboard was turned off.");
              }
              setBoardTheme(nextTheme);
              try {
                window.localStorage.setItem("airboard.theme.v1", nextTheme);
              } catch {
                // Preference persistence is best-effort.
              }
            }}
          />
          <span>
            Lightboard (neon) theme
            {cameraCanvasLocked ? " · required while camera overlay is on" : ""}
          </span>
        </label>
        <label className="check-row" htmlFor="airo-sounds">
          <input
            id="airo-sounds"
            type="checkbox"
            checked={airoSounds}
            onChange={(event) => {
              setAiroSoundsEnabled(event.target.checked);
              setAiroSounds(event.target.checked);
            }}
          />
          <span>Quiet sounds when Airo applies, misses, or asks</span>
        </label>
        {boardTheme === "lightboard" ? (
          <>
            <div className="status-grid screen-underlay-status" data-testid="screen-underlay-status">
              <span>Screen/window</span>
              <strong
                className={
                  screenUnderlayStatus === "active"
                    ? "pill"
                    : screenUnderlayStatus === "blocked" || screenUnderlayStatus === "error"
                      ? "pill warning"
                      : undefined
                }
              >
                {screenUnderlayStatusLabel(screenUnderlayStatus)}
              </strong>
            </div>
            <label className="check-row" htmlFor="camera-underlay">
              <input
                id="camera-underlay"
                type="checkbox"
                checked={cameraUnderlayEnabled}
                disabled={cameraStatus === "active"}
                onChange={(event) => {
                  setCameraUnderlayEnabled(event.target.checked);
                  try {
                    window.localStorage.setItem(
                      "airboard.underlay.v1",
                      event.target.checked ? "on" : "off",
                    );
                  } catch {
                    // Preference persistence is best-effort.
                  }
                }}
              />
              <span>Camera behind the dark canvas when no screen is selected</span>
            </label>
            <label className="check-row" htmlFor="local-contrast-plates">
              <input
                id="local-contrast-plates"
                data-testid="local-contrast-plates"
                type="checkbox"
                checked={localContrastPlatesEnabled}
                onChange={(event) => {
                  setLocalContrastPlatesEnabled(event.target.checked);
                  try {
                    window.localStorage.setItem(
                      "airboard.contrast-plates.v1",
                      event.target.checked ? "on" : "off",
                    );
                  } catch {
                    // Preference persistence is best-effort.
                  }
                }}
              />
              <span>Local contrast behind diagram clusters</span>
            </label>
            <div className="control-row">
              <label htmlFor="scrim-opacity">Dark overlay</label>
              <div className="range-with-value">
                <input
                  id="scrim-opacity"
                  type="range"
                  min={screenUnderlayStatus === "active" ? 0 : MIN_CAMERA_PRESENTATION_SCRIM}
                  max={1}
                  step={0.05}
                  value={scrimOpacity}
                  onChange={(event) => {
                    const requested = Number(event.target.value);
                    const next =
                      screenUnderlayStatus === "active"
                        ? screenFriendlyScrim(requested)
                        : cameraCanvasScrim(requested);
                    scrimOpacityRef.current = next;
                    setScrimOpacity(next);
                    try {
                      window.localStorage.setItem(
                        screenUnderlayStatus === "active"
                          ? "airboard.scrim.screen.v1"
                          : "airboard.scrim.camera.v1",
                        String(next),
                      );
                    } catch {
                      // Preference persistence is best-effort.
                    }
                  }}
                />
                <output htmlFor="scrim-opacity" data-testid="scrim-value">
                  {Math.round(scrimOpacity * 100)}%
                </output>
              </div>
            </div>
            <p className="hint" data-testid="screen-underlay-notice">
              {screenUnderlayNotice ??
                (cameraUnderlayEnabled && cameraStatus === "active"
                  ? "Camera is behind the board. Choose Show a screen behind the board in ••• to use a screen or window instead."
                  : "No live background is selected, so the dark overlay appears solid. Choose Show a screen behind the board in •••, or allow the camera for this site.")}
            </p>
          </>
        ) : null}
      </section>

      <section className="section">
        <h2>Studio</h2>
        <p className="hint">
          Record what a viewer sees — your selected screen or camera behind the glowing
          board, with your microphone — as a local WebM file. Nothing is uploaded.
        </p>
        <button
          type="button"
          className={recordingState === "recording" ? "danger" : "primary"}
          data-testid="studio-record"
          onClick={() =>
            recordingState === "recording"
              ? void stopStudioRecording()
              : void startStudioRecording()
          }
        >
          {recordingState === "recording"
            ? `Stop recording (${formatRecordingClock(recordingSeconds)})`
            : "Start recording"}
        </button>
        {recordingNotice ? <p className="hint">{recordingNotice}</p> : null}
      </section>

      <section className="section">
        <h2>Input Controls</h2>
        <p className="hint">
          Hold an open palm still for 0.4 seconds to speak. Use a relaxed hand to aim and a closed hand to move.
        </p>
        <details className="advanced-settings gesture-guide">
          <summary>Gesture guide</summary>
          <dl>
            <div>
              <dt>Aim</dt>
              <dd>Move one relaxed hand without holding a command pose.</dd>
            </div>
            <div>
              <dt>Choose or select</dt>
              <dd>
                Aim near a dock control or object and start closing one hand. The first
                highlighted target activates; reopen before choosing another. Camera
                gestures select one object only and never draw a lasso.
              </dd>
            </div>
            <div>
              <dt>Move</dt>
              <dd>
                Keep Select active. Close over the object body, wait for “Move locked,”
                move it, then reopen.
              </dd>
            </div>
            <div>
              <dt>Place</dt>
              <dd>
                Choose a shape first. Move onto the canvas, close one hand, wait for
                “Holding,” position the preview, then reopen.
              </dd>
            </div>
            <div>
              <dt>Erase</dt>
              <dd>
                Choose Eraser first. Close over an object, wait for the erase state,
                sweep across targets, then reopen.
              </dd>
            </div>
            <div>
              <dt>Speak to Airo</dt>
              <dd>
                Hold one open palm still (no sideways motion) for about 0.4 seconds.
                Lower or relax it when finished.
              </dd>
            </div>
            <div>
              <dt>Voice-edit one object</dt>
              <dd>
                Close one hand over the object and hold it still for about
                0.6 seconds, then say the change.
              </dd>
            </div>
            <div>
              <dt>Hide or show diagram</dt>
              <dd>
                With one hand, touch thumb to middle finger while keeping the index
                separated. Then flick the middle finger away quickly—the touch alone
                does nothing. Fully relax before snapping again.
              </dd>
            </div>
            <div>
              <dt>Pan</dt>
              <dd>Hold two open hands briefly, then move them together.</dd>
            </div>
            <div>
              <dt>Zoom</dt>
              <dd>
                Hold two closed hands briefly, then spread them apart or bring them
                together.
              </dd>
            </div>
          </dl>
          <p>
            Camera gestures do not resize objects or select an area. Use pointer
            handles or a typed or voice resize command. Shift+H toggles diagram
            visibility, and Cmd/Ctrl+Z always undoes.
          </p>
        </details>
        <details className="advanced-settings">
          <summary>Advanced settings</summary>
          <div className="control-row">
            <label htmlFor="confidence">Hand confidence</label>
            <input
              id="confidence"
              type="range"
              min="0.4"
              max="0.95"
              step="0.01"
              value={confidenceThreshold}
              onChange={(event) => {
                const nextConfidence = Number(event.target.value);
                setConfidenceThreshold(nextConfidence);
                if (cameraStatus === "active") {
                  pendingCameraConfidenceRestartRef.current = true;
                  stopCamera();
                }
              }}
            />
          </div>
          <p className="hint">
            This controls HandLandmarker detection, presence, and tracking thresholds.
            An active camera restarts so the new threshold takes effect immediately.
          </p>
          <label className="check-row" htmlFor="auto-snap-connectors">
            <input
              id="auto-snap-connectors"
              type="checkbox"
              checked={autoSnapConnectors}
              onChange={(event) => setAutoSnapConnectors(event.target.checked)}
            />
            <span>Object, grid, and connector snapping</span>
          </label>
        </details>
      </section>

      <section className="section">
        <h2>Shortcuts</h2>
        <p className="hint">
          Use the Gesture guide above for exact poses. A held open palm activates voice. A relaxed hand aims, a closed hand moves, and thumb-middle snaps hide or restore the diagram. Use Cmd/Ctrl+Z or the toolbar to undo.
        </p>
      </section>
    </aside>
  );
}
