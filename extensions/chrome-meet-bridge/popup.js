"use strict";
const APP_URL = "https://airboard-pilot-web-634900453473.asia-south1.run.app";
const connectPanel = document.getElementById("connect-panel");
const consentPanel = document.getElementById("consent-panel");
const readyPanel = document.getElementById("ready-panel");
const errorNode = document.getElementById("error");
const stateDot = document.getElementById("state-dot");

document.getElementById("connect").addEventListener("click", () => chrome.tabs.create({ url: `${APP_URL}/app/integrations?setup=chrome_meet&extensionId=${chrome.runtime.id}&version=${chrome.runtime.getManifest().version}` }));
document.getElementById("settings").addEventListener("click", () => chrome.tabs.create({ url: `${APP_URL}/app/settings/preferences` }));
document.getElementById("open-meet").addEventListener("click", () => chrome.tabs.create({ url: "https://meet.google.com/new" }));
document.getElementById("refresh").addEventListener("click", refresh);
document.getElementById("confirm-check").addEventListener("change", (event) => { document.getElementById("confirm").disabled = !event.target.checked; });
document.getElementById("confirm").addEventListener("click", () => chrome.runtime.sendMessage({ type: "AIRBOARD_CONFIRM_MEDIA" }, (result) => result?.ok ? refresh() : showError(result?.error)));
document.querySelectorAll("[data-setting]").forEach((input) => input.addEventListener("change", () => {
  const settings = {};
  document.querySelectorAll("[data-setting]").forEach((node) => { settings[node.dataset.setting] = node.checked; node.disabled = true; });
  chrome.runtime.sendMessage({ type: "AIRBOARD_SET_SETTINGS", settings }, (result) => {
    document.querySelectorAll("[data-setting]").forEach((node) => { node.disabled = false; });
    if (!result?.ok) showError(result?.error); else render(result);
  });
}));

function load() {
  chrome.runtime.sendMessage({ type: "AIRBOARD_GET_STATE" }, (state) => {
    render(state);
    if (state?.linked) refresh();
  });
}
function refresh() { chrome.runtime.sendMessage({ type: "AIRBOARD_REFRESH_STATUS" }, render); }
function render(state) {
  if (!state) return showError(chrome.runtime.lastError?.message || "Airboard state unavailable.");
  connectPanel.hidden = state.linked;
  consentPanel.hidden = !state.linked || state.consented;
  readyPanel.hidden = !state.linked || !state.consented;
  const diagnostics = state.diagnostics || {};
  const verified = state.preflightComplete || (diagnostics.senderAttached && diagnostics.framesEncoded > 0 && diagnostics.bytesSent > 0);
  const ready = state.linked && state.consented && state.entitled && verified;
  stateDot.className = `dot ${ready ? "ready" : state.linked ? "progress" : ""}`;
  document.querySelectorAll("[data-setting]").forEach((node) => {
    node.checked = state.settings?.[node.dataset.setting] !== false;
    node.disabled = (node.dataset.setting === "overlayEnabled" && state.policy?.allowed === false)
      || (node.dataset.setting === "videoEnabled" && state.policy?.cameraEnabled === false)
      || (node.dataset.setting === "audioEnabled" && state.policy?.voiceEnabled === false);
  });
  document.getElementById("ready-kicker").textContent = ready ? "Outgoing camera verified" : state.entitled ? "Setup in progress" : "Access required";
  document.getElementById("ready-title").textContent = ready ? "Airboard is ready" : state.entitled ? "One clear path to ready" : "Trial or plan unavailable";
  document.getElementById("ready-detail").textContent = ready
    ? "Meet is encoding and sending your Airboard composite."
    : nextAction(state, diagnostics);
  const checks = {
    linked: state.linked,
    consented: state.consented,
    meetingDetected: diagnostics.meetingDetected,
    engineMounted: diagnostics.engineMounted,
    engaged: diagnostics.engaged,
    verified,
  };
  document.querySelectorAll("[data-check]").forEach((node) => {
    const complete = checks[node.dataset.check] === true;
    node.className = complete ? "complete" : "";
    node.querySelector(":scope > span").textContent = complete ? "✓" : String([...node.parentElement.children].indexOf(node) + 1);
  });
  document.getElementById("verification").textContent = state.lastVerifiedAt
    ? `Last verified ${new Date(state.lastVerifiedAt).toLocaleString()}`
    : "Your 3-day trial starts only after the first verified outgoing composite.";
  if (state.lastError) showError(errorMessage(state.lastError)); else errorNode.hidden = true;
}
function nextAction(state, diagnostics) {
  if (!state.entitled) return "Reconnect Airboard or check your plan.";
  if (!diagnostics.meetingDetected) return "Open a Google Meet meeting to continue.";
  if (!diagnostics.engineMounted) return "The private engine is starting. Refresh Meet if this persists.";
  if (!diagnostics.engaged) return "Turn the Meet camera on; Airboard will attach automatically.";
  return "Waiting for Meet to encode and send the composited camera.";
}
function errorMessage(code) {
  const messages = {
    INSTALLATION_RECONNECT_REQUIRED: "This installation credential expired or was revoked. Connect Airboard again.",
    CONNECT_AIRBOARD_FIRST: "Connect this browser to Airboard first.",
    "camera-unavailable: NotAllowedError": "Chrome cannot access the camera. Allow camera access for meet.google.com.",
    "microphone-unavailable: NotAllowedError": "Chrome cannot access the microphone. Allow microphone access for meet.google.com.",
  };
  return messages[code] || String(code || "Unknown error");
}
function showError(message) { errorNode.hidden = false; errorNode.textContent = errorMessage(message); }
load();
