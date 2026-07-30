/**
 * Shared semantic-provider contract metadata.
 *
 * Keep this module dependency-free so production, evaluation runners, and
 * report generators all consume the same prompt version without importing a
 * provider implementation or copying a version literal.
 */
export const AIRBOARD_SEMANTIC_INTENT_PROMPT_VERSION = "2.7" as const;
