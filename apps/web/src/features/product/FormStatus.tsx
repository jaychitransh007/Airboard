/**
 * A form's result line that screen readers announce. It stays mounted while
 * empty, because a live region added together with its text is often missed;
 * the stylesheet takes an empty one out of the layout.
 */
export function FormStatus({ message, tone = "message" }: { message: string | null | undefined; tone?: "message" | "warning" }) {
  return tone === "warning"
    ? <p className="form-warning" role="alert">{message ?? ""}</p>
    : <p className="form-message" role="status">{message ?? ""}</p>;
}
