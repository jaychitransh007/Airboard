import {
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import {
  isAbsolute,
  relative,
  resolve,
} from "node:path";

export const MEET_ATTESTATION_SCHEMA_VERSION =
  "airboard-meet-station-attestation.v1";
export const MEET_ATTESTATION_MAX_AGE_MS = 2 * 60 * 60 * 1_000;

const REQUIRED_ONE_FLAGS = [
  "AIRBOARD_EVAL_REAL_CAMERA",
  "AIRBOARD_EVAL_REAL_MICROPHONE",
  "AIRBOARD_EVAL_MEET_BRIDGE",
];
const REQUIRED_VALUES = [
  "AIRBOARD_EVAL_DEVICE_ID",
  "AIRBOARD_EVAL_EXPECTED_CAMERA_LABEL_PATTERN",
  "AIRBOARD_EVAL_EXPECTED_MICROPHONE_LABEL_PATTERN",
  "AIRBOARD_EVAL_MEET_ATTESTATION_PATH",
];

/**
 * Validate the protected station contract without opening a media device.
 *
 * The Meet flag is only an opt-in. A recent receiver-side attestation stored
 * outside the checkout is the evidence that makes the Meet portion eligible.
 */
export function validateDeviceEvalContract({
  env = process.env,
  platform = process.platform,
  nowMs = Date.now(),
  repositoryRoot = process.cwd(),
} = {}) {
  const failures = [];

  if (!["darwin", "win32"].includes(platform)) {
    failures.push(
      `device evaluation requires macOS or Windows; received ${platform}`,
    );
  }

  for (const name of REQUIRED_ONE_FLAGS) {
    if (env[name] !== "1") {
      failures.push(`${name} must be exactly 1`);
    }
  }
  for (const name of REQUIRED_VALUES) {
    if (!env[name]?.trim()) {
      failures.push(`${name} is not configured`);
    }
  }

  validateExpectedLabelPattern(
    env.AIRBOARD_EVAL_EXPECTED_CAMERA_LABEL_PATTERN,
    "AIRBOARD_EVAL_EXPECTED_CAMERA_LABEL_PATTERN",
    failures,
  );
  validateExpectedLabelPattern(
    env.AIRBOARD_EVAL_EXPECTED_MICROPHONE_LABEL_PATTERN,
    "AIRBOARD_EVAL_EXPECTED_MICROPHONE_LABEL_PATTERN",
    failures,
  );

  let attestation = null;
  if (
    env.AIRBOARD_EVAL_MEET_ATTESTATION_PATH?.trim() &&
    env.AIRBOARD_EVAL_DEVICE_ID?.trim()
  ) {
    const loaded = loadMeetStationAttestation({
      path: env.AIRBOARD_EVAL_MEET_ATTESTATION_PATH.trim(),
      repositoryRoot,
    });
    failures.push(...loaded.failures);
    if (loaded.value) {
      const validated = validateMeetStationAttestation(loaded.value, {
        deviceId: env.AIRBOARD_EVAL_DEVICE_ID.trim(),
        nowMs,
      });
      failures.push(...validated.failures);
      if (validated.failures.length === 0) {
        attestation = validated.summary;
      }
    }
  }

  return {
    valid: failures.length === 0,
    failures,
    attestation,
  };
}

export function loadMeetStationAttestation({ path, repositoryRoot }) {
  const failures = [];
  if (!isAbsolute(path)) {
    return {
      value: null,
      failures: [
        "AIRBOARD_EVAL_MEET_ATTESTATION_PATH must be an absolute station path",
      ],
    };
  }

  try {
    const realPath = realpathSync(path);
    const realRepositoryRoot = realpathSync(resolve(repositoryRoot));
    const repositoryRelative = relative(realRepositoryRoot, realPath);
    if (
      repositoryRelative === "" ||
      (!repositoryRelative.startsWith("..") &&
        !isAbsolute(repositoryRelative))
    ) {
      failures.push(
        "Meet station attestation must live outside the repository checkout",
      );
    }
    const stat = statSync(realPath);
    if (!stat.isFile()) {
      failures.push("Meet station attestation is not a regular file");
    }
    if (stat.size > 64 * 1_024) {
      failures.push("Meet station attestation exceeds the 64 KiB limit");
    }
    if (failures.length > 0) return { value: null, failures };
    const value = JSON.parse(readFileSync(realPath, "utf8"));
    return { value, failures };
  } catch {
    return {
      value: null,
      failures: ["Meet station attestation could not be read or parsed"],
    };
  }
}

export function validateMeetStationAttestation(
  value,
  { deviceId, nowMs = Date.now() },
) {
  const failures = [];
  if (!isRecord(value)) {
    return {
      failures: ["Meet station attestation must be a JSON object"],
      summary: null,
    };
  }
  rejectUnexpectedKeys(
    value,
    [
      "schemaVersion",
      "attestationId",
      "stationDeviceId",
      "issuedBy",
      "observedAt",
      "expiresAt",
      "meetingCodeHash",
      "sender",
      "receiver",
      "privacy",
    ],
    "Meet station attestation",
    failures,
  );

  exact(
    value.schemaVersion,
    MEET_ATTESTATION_SCHEMA_VERSION,
    "Meet station attestation schemaVersion",
    failures,
  );
  exact(
    value.stationDeviceId,
    deviceId,
    "Meet station attestation device binding",
    failures,
  );
  nonEmpty(value.attestationId, "Meet station attestation ID", failures);
  nonEmpty(value.issuedBy, "Meet station attestation issuer", failures);
  if (!/^[a-f0-9]{64}$/iu.test(value.meetingCodeHash ?? "")) {
    failures.push(
      "Meet station attestation must contain a SHA-256 meetingCodeHash",
    );
  }

  const observedAtMs = Date.parse(value.observedAt ?? "");
  const expiresAtMs = Date.parse(value.expiresAt ?? "");
  if (!Number.isFinite(observedAtMs)) {
    failures.push("Meet station attestation observedAt is invalid");
  } else {
    if (observedAtMs > nowMs + 5 * 60 * 1_000) {
      failures.push("Meet station attestation observedAt is in the future");
    }
    if (nowMs - observedAtMs > MEET_ATTESTATION_MAX_AGE_MS) {
      failures.push("Meet station attestation is older than two hours");
    }
  }
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    failures.push("Meet station attestation is expired");
  } else if (
    Number.isFinite(observedAtMs) &&
    expiresAtMs - observedAtMs > MEET_ATTESTATION_MAX_AGE_MS
  ) {
    failures.push(
      "Meet station attestation validity may not exceed two hours",
    );
  }

  const sender = value.sender;
  if (!isRecord(sender)) {
    failures.push("Meet station attestation sender evidence is missing");
  } else {
    rejectUnexpectedKeys(
      sender,
      [
        "compositorEngaged",
        "senderAttached",
        "encodedFramesDelta",
        "outboundBytesDelta",
      ],
      "Meet sender evidence",
      failures,
    );
    truthy(sender.compositorEngaged, "Meet compositor engagement", failures);
    truthy(sender.senderAttached, "Meet sender attachment", failures);
    positiveInteger(
      sender.encodedFramesDelta,
      "Meet encoded-frame delta",
      failures,
    );
    positiveInteger(
      sender.outboundBytesDelta,
      "Meet outbound-byte delta",
      failures,
    );
  }

  const receiver = value.receiver;
  if (!isRecord(receiver)) {
    failures.push("Meet station attestation receiver evidence is missing");
  } else {
    rejectUnexpectedKeys(
      receiver,
      ["method", "expectedOverlayObserved", "participantCount"],
      "Meet receiver evidence",
      failures,
    );
    if (
      !["second_participant", "receiver_station_automation"].includes(
        receiver.method,
      )
    ) {
      failures.push(
        "Meet receiver verification method must be independent of the sender preview",
      );
    }
    truthy(
      receiver.expectedOverlayObserved,
      "Meet receiver overlay observation",
      failures,
    );
    positiveInteger(
      receiver.participantCount,
      "Meet receiver participant count",
      failures,
    );
  }

  const privacy = value.privacy;
  if (!isRecord(privacy)) {
    failures.push("Meet station attestation privacy declaration is missing");
  } else {
    rejectUnexpectedKeys(
      privacy,
      ["rawMediaRetained", "contentCaptured"],
      "Meet privacy declaration",
      failures,
    );
    exact(
      privacy.rawMediaRetained,
      false,
      "Meet raw-media retention declaration",
      failures,
    );
    exact(
      privacy.contentCaptured,
      false,
      "Meet content-capture declaration",
      failures,
    );
  }

  return {
    failures,
    summary:
      failures.length === 0
        ? {
            schemaVersion: MEET_ATTESTATION_SCHEMA_VERSION,
            receiverVerified: true,
            rawMediaRetained: false,
          }
        : null,
  };
}

function validateExpectedLabelPattern(source, name, failures) {
  if (!source?.trim()) return;
  if (source.length > 256) {
    failures.push(`${name} exceeds 256 characters`);
    return;
  }
  try {
    const pattern = new RegExp(source, "iu");
    if (pattern.test("")) {
      failures.push(`${name} must not match an empty device label`);
    }
    const literalCharacters = source.replace(/[^\p{L}\p{N}]/gu, "");
    if (literalCharacters.length < 4) {
      failures.push(`${name} is too broad to bind the station hardware`);
    }
  } catch {
    failures.push(`${name} is not a valid regular expression`);
  }
}

function exact(actual, expected, label, failures) {
  if (actual !== expected) failures.push(`${label} is invalid`);
}

function truthy(value, label, failures) {
  if (value !== true) failures.push(`${label} was not proven`);
}

function positiveInteger(value, label, failures) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    failures.push(`${label} must be a positive integer`);
  }
}

function nonEmpty(value, label, failures) {
  if (typeof value !== "string" || !value.trim()) {
    failures.push(`${label} is missing`);
  }
}

function rejectUnexpectedKeys(value, allowed, label, failures) {
  const unexpected = Object.keys(value).filter(
    (key) => !allowed.includes(key),
  );
  if (unexpected.length > 0) {
    failures.push(`${label} contains unsupported fields`);
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
