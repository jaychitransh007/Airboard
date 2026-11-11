export type BoardTitleValidation =
  | { valid: true; title: string }
  | { valid: false; message: string };

export function validateBoardTitle(value: string): BoardTitleValidation {
  const title = value.trim();
  if (!title) return { valid: false, message: "Canvas name cannot be empty." };
  if (title.length > 240) {
    return {
      valid: false,
      message: "Canvas name must be 240 characters or less.",
    };
  }
  if (/[\u0000-\u001f\u007f]/.test(title)) {
    return {
      valid: false,
      message: "Canvas name contains unsupported control characters.",
    };
  }
  return { valid: true, title };
}
