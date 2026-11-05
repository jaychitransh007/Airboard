/**
 * Build a deterministic, content-free confusion matrix from categorical
 * oracle/observation pairs. Labels are bounded by the caller's categories;
 * customer text and media-derived values must never be passed here.
 */
export function buildConfusionMatrix(pairs) {
  const counts = new Map();
  const labels = new Set();
  let total = 0;
  for (const pair of pairs ?? []) {
    const expected = normalizeLabel(pair?.expected);
    const actual = normalizeLabel(pair?.actual);
    labels.add(expected);
    labels.add(actual);
    const key = `${expected}\u0000${actual}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    total += 1;
  }
  const sortedLabels = [...labels].sort();
  const matrix = Object.fromEntries(
    sortedLabels.map((expected) => [
      expected,
      Object.fromEntries(
        sortedLabels.map((actual) => [
          actual,
          counts.get(`${expected}\u0000${actual}`) ?? 0,
        ]),
      ),
    ]),
  );
  return {
    labels: sortedLabels,
    total,
    matrix,
    cells: [...counts.entries()]
      .map(([key, count]) => {
        const [expected, actual] = key.split("\u0000");
        return { expected, actual, count };
      })
      .sort(
        (left, right) =>
          left.expected.localeCompare(right.expected) ||
          left.actual.localeCompare(right.actual),
      ),
  };
}

function normalizeLabel(value) {
  const label =
    typeof value === "string" && value.trim()
      ? value.trim()
      : "unknown";
  return label.slice(0, 80);
}
