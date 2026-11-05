import {
  parseTranscriptionControlMessage,
} from "../../../apps/api/src/transcription/protocol.ts";
import {
  REALTIME_TRANSCRIPTION_FRAME_DURATION_MS,
} from "../../../apps/web/src/features/board/realtimeSpeech.ts";

const RIFF_HEADER_BYTES = 12;
const MAX_WAV_BYTES = 256 * 1024 * 1024;

export class Pcm16WavError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "Pcm16WavError";
    this.code = code;
  }
}

/**
 * Strictly validates a mono, little-endian PCM16 WAV before any bytes are sent
 * to the production transcription gateway.
 */
export function parsePcm16Wav(input) {
  const bytes = toUint8Array(input);
  if (bytes.byteLength < RIFF_HEADER_BYTES) {
    throw wavError("WAV_TRUNCATED", "WAV data is shorter than the RIFF header.");
  }
  if (bytes.byteLength > MAX_WAV_BYTES) {
    throw wavError("WAV_TOO_LARGE", "WAV data exceeds the 256 MiB evaluation bound.");
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") {
    throw wavError("WAV_INVALID_CONTAINER", "Expected a little-endian RIFF/WAVE container.");
  }
  const riffEnd = view.getUint32(4, true) + 8;
  if (riffEnd !== bytes.byteLength) {
    throw wavError(
      "WAV_INVALID_RIFF_SIZE",
      "The RIFF size does not match the supplied WAV byte length.",
    );
  }

  let format = null;
  let pcm = null;
  let offset = RIFF_HEADER_BYTES;
  while (offset < riffEnd) {
    if (offset + 8 > riffEnd) {
      throw wavError("WAV_TRUNCATED_CHUNK", "A WAV chunk header is truncated.");
    }
    const chunkId = ascii(bytes, offset, 4);
    const chunkName = /^[\x20-\x7e]{4}$/u.test(chunkId) ? chunkId : "unknown";
    const chunkSize = view.getUint32(offset + 4, true);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkSize;
    if (dataEnd > riffEnd) {
      throw wavError("WAV_TRUNCATED_CHUNK", `The ${chunkName} WAV chunk is truncated.`);
    }
    if (chunkSize % 2 === 1 && dataEnd === riffEnd) {
      throw wavError(
        "WAV_TRUNCATED_CHUNK",
        `The ${chunkName} WAV chunk is missing its alignment byte.`,
      );
    }

    if (chunkId === "fmt ") {
      if (format) {
        throw wavError("WAV_DUPLICATE_FORMAT", "WAV contains more than one format chunk.");
      }
      if (chunkSize < 16) {
        throw wavError("WAV_INVALID_FORMAT", "The PCM format chunk must be at least 16 bytes.");
      }
      format = {
        audioFormat: view.getUint16(dataStart, true),
        channels: view.getUint16(dataStart + 2, true),
        sampleRate: view.getUint32(dataStart + 4, true),
        byteRate: view.getUint32(dataStart + 8, true),
        blockAlign: view.getUint16(dataStart + 12, true),
        bitsPerSample: view.getUint16(dataStart + 14, true),
      };
    } else if (chunkId === "data") {
      if (pcm) {
        throw wavError("WAV_DUPLICATE_DATA", "WAV contains more than one data chunk.");
      }
      // Buffer#slice is a view over the whole WAV allocation. Copy into a
      // plain Uint8Array so downstream framing cannot retain headers/metadata.
      pcm = Uint8Array.from(bytes.subarray(dataStart, dataEnd));
    }

    offset = dataEnd + (chunkSize % 2);
  }

  if (!format) {
    throw wavError("WAV_MISSING_FORMAT", "WAV is missing its format chunk.");
  }
  if (!pcm || pcm.byteLength === 0) {
    throw wavError("WAV_MISSING_AUDIO", "WAV contains no PCM audio samples.");
  }
  if (format.audioFormat !== 1) {
    throw wavError("WAV_NOT_LINEAR_PCM", "WAV audio must use uncompressed integer PCM.");
  }
  if (format.channels !== 1) {
    throw wavError("WAV_NOT_MONO", "WAV audio must contain exactly one channel.");
  }
  if (format.bitsPerSample !== 16 || format.blockAlign !== 2) {
    throw wavError("WAV_NOT_PCM16", "WAV audio must contain signed 16-bit PCM samples.");
  }
  if (format.byteRate !== format.sampleRate * format.blockAlign) {
    throw wavError("WAV_INVALID_BYTE_RATE", "WAV byte rate is inconsistent with its PCM format.");
  }
  if (pcm.byteLength % format.blockAlign !== 0) {
    throw wavError("WAV_PARTIAL_SAMPLE", "WAV data ends in a partial PCM16 sample.");
  }

  const protocolCheck = parseTranscriptionControlMessage(
    JSON.stringify({
      type: "transcription.start",
      sampleRate: format.sampleRate,
    }),
  );
  if (!protocolCheck.ok) {
    throw wavError(
      "WAV_UNSUPPORTED_SAMPLE_RATE",
      `WAV sample rate is not accepted by the production transcription protocol: ${protocolCheck.error.message}`,
    );
  }

  const sampleCount = pcm.byteLength / format.blockAlign;
  return {
    sampleRate: format.sampleRate,
    channels: format.channels,
    bitsPerSample: format.bitsPerSample,
    sampleCount,
    durationSeconds: sampleCount / format.sampleRate,
    pcmBytes: pcm,
  };
}

/**
 * Streams the same 80 ms PCM16 frame cadence used by realtimeSpeech.ts.
 * The final frame is zero-padded by default, matching the production client.
 */
export function* streamPcm16WavFrames(
  wav,
  {
    frameDurationMs = REALTIME_TRANSCRIPTION_FRAME_DURATION_MS,
    padFinalFrame = true,
  } = {},
) {
  if (
    typeof frameDurationMs !== "number" ||
    !Number.isFinite(frameDurationMs) ||
    frameDurationMs <= 0
  ) {
    throw new TypeError("frameDurationMs must be a positive finite number.");
  }
  const frameSamples = Math.max(1, Math.round((wav.sampleRate * frameDurationMs) / 1_000));
  const frameBytes = frameSamples * 2;
  for (let offset = 0; offset < wav.pcmBytes.byteLength; offset += frameBytes) {
    const remaining = wav.pcmBytes.byteLength - offset;
    if (remaining >= frameBytes || !padFinalFrame) {
      yield wav.pcmBytes.slice(offset, Math.min(offset + frameBytes, wav.pcmBytes.byteLength));
      continue;
    }
    const padded = new Uint8Array(frameBytes);
    padded.set(wav.pcmBytes.slice(offset));
    yield padded;
  }
}

function toUint8Array(input) {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (input instanceof ArrayBuffer) {
    return new Uint8Array(input);
  }
  throw new TypeError("WAV input must be an ArrayBuffer or Uint8Array.");
}

function ascii(bytes, offset, length) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function wavError(code, message) {
  return new Pcm16WavError(code, message);
}
