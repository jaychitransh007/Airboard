export type VoiceTraceValue =
  | string
  | number
  | boolean
  | null
  | VoiceTraceValue[]
  | { [key: string]: VoiceTraceValue };

export type VoiceTraceData = Record<string, VoiceTraceValue>;

export type VoiceTraceAppend = {
  voiceTurnId: string;
  stage: string;
  occurredAt?: string;
  data?: VoiceTraceData;
};

export type VoiceTraceEvent = VoiceTraceAppend & {
  sequence: number;
  receivedAt: string;
};

export type VoiceTraceSnapshot = {
  voiceTurnId: string;
  events: VoiceTraceEvent[];
  droppedEvents: number;
};
