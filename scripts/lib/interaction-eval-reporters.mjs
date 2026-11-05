import {
  INTERACTION_EVAL_REPORT_SCHEMA_VERSION,
  summarizeResults,
} from "./interaction-eval-corpus.mjs";

export function buildInteractionEvalReport(input, options = {}) {
  const source = Array.isArray(input) ? { results: input } : input ?? {};
  const results = Array.isArray(source.results)
    ? source.results.map(withEvidenceProvenance)
    : [];
  const report = {
    schemaVersion:
      source.schemaVersion === INTERACTION_EVAL_REPORT_SCHEMA_VERSION
        ? source.schemaVersion
        : INTERACTION_EVAL_REPORT_SCHEMA_VERSION,
    ...(source.corpusSchemaVersion
      ? { corpusSchemaVersion: source.corpusSchemaVersion }
      : {}),
    ...(source.capabilityRegistryVersion
      ? { capabilityRegistryVersion: source.capabilityRegistryVersion }
      : {}),
    generatedAt:
      options.generatedAt ??
      source.generatedAt ??
      new Date().toISOString(),
    summary: summarizeResults(results),
    ...(source.coverage ? { coverage: source.coverage } : {}),
    ...(source.confusionMatrices
      ? { confusionMatrices: source.confusionMatrices }
      : {}),
    results,
  };
  if (options.metadata || source.metadata) {
    report.metadata = { ...(source.metadata ?? {}), ...(options.metadata ?? {}) };
  }
  return report;
}

function withEvidenceProvenance(result) {
  if (result?.evidenceProvenance) return result;
  return {
    ...result,
    evidenceProvenance: {
      class: "unspecified",
      releaseEligible: false,
      timedInput: false,
      timedInputCount: 0,
      routeObservation: "unobserved",
      outcomeObservation: "unobserved",
      components: [],
      reason:
        "The result did not declare evidence provenance and is diagnostic only.",
    },
  };
}

export function emitJsonReport(input, options = {}) {
  const report = buildInteractionEvalReport(input, options);
  return `${JSON.stringify(report, null, options.pretty === false ? 0 : 2)}\n`;
}

export const renderJsonReport = emitJsonReport;

export function emitJunitReport(input, options = {}) {
  const report = buildInteractionEvalReport(input, options);
  const name = options.suiteName ?? "Airboard interaction evals";
  const className = options.className ?? "interaction-eval";
  const summary = report.summary;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="${xml(name)}" tests="${summary.total}" failures="${summary.failed}" errors="${summary.errors}" skipped="${summary.skipped}" time="${seconds(summary.durationMs)}">`,
  ];

  if (
    report.corpusSchemaVersion ||
    report.capabilityRegistryVersion ||
    report.generatedAt
  ) {
    lines.push("  <properties>");
    if (report.corpusSchemaVersion) {
      lines.push(
        `    <property name="corpus.schemaVersion" value="${xml(report.corpusSchemaVersion)}"/>`,
      );
    }
    if (report.capabilityRegistryVersion) {
      lines.push(
        `    <property name="capabilityRegistry.version" value="${xml(report.capabilityRegistryVersion)}"/>`,
      );
    }
    lines.push(
      `    <property name="generatedAt" value="${xml(report.generatedAt)}"/>`,
    );
    lines.push("  </properties>");
  }

  for (const result of report.results) {
    const testName = result.title
      ? `${result.caseId}: ${result.title}`
      : result.caseId;
    lines.push(
      `  <testcase classname="${xml(className)}" name="${xml(testName)}" time="${seconds(result.durationMs)}">`,
    );
    if (result.evidenceProvenance) {
      lines.push("    <properties>");
      lines.push(
        `      <property name="evidence.class" value="${xml(result.evidenceProvenance.class ?? "unspecified")}"/>`,
      );
      lines.push(
        `      <property name="evidence.releaseEligible" value="${xml(String(result.evidenceProvenance.releaseEligible === true))}"/>`,
      );
      lines.push("    </properties>");
    }
    if (result.status === "failed") {
      const message = failedMessage(result);
      lines.push(
        `    <failure message="${xml(message)}">${xml(failureDetails(result))}</failure>`,
      );
    } else if (result.status === "error") {
      const message = result.error?.message ?? "Interaction eval executor error";
      lines.push(
        `    <error type="${xml(result.error?.name ?? "Error")}" message="${xml(message)}">${xml(result.error?.stack ?? message)}</error>`,
      );
    } else if (result.status === "skipped") {
      lines.push('    <skipped message="Interaction eval skipped"/>');
    }
    if (options.includeObserved && result.observed) {
      lines.push(
        `    <system-out>${xml(JSON.stringify(result.observed, null, 2))}</system-out>`,
      );
    }
    lines.push("  </testcase>");
  }
  if (report.confusionMatrices) {
    lines.push(
      `  <system-out>${xml(JSON.stringify({ confusionMatrices: report.confusionMatrices }, null, 2))}</system-out>`,
    );
  }
  lines.push("</testsuite>");
  return `${lines.join("\n")}\n`;
}

export const emitJUnitReport = emitJunitReport;
export const renderJunitReport = emitJunitReport;
export const renderJUnitReport = emitJunitReport;

export function emitMarkdownReport(input, options = {}) {
  const report = buildInteractionEvalReport(input, options);
  const title = options.title ?? "Airboard interaction eval report";
  const summary = report.summary;
  const passPercent =
    summary.total === 0 ? "0.0" : ((summary.passed / summary.total) * 100).toFixed(1);
  const lines = [
    `# ${title}`,
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Passed **${summary.passed}/${summary.total}** (${passPercent}%). Failed: ${summary.failed}. Errors: ${summary.errors}. Skipped: ${summary.skipped}. Duration: ${formatDuration(summary.durationMs)}.`,
    "",
    "| Status | Case | Duration | Evidence | Capabilities |",
    "| --- | --- | ---: | --- | --- |",
  ];

  for (const result of report.results) {
    lines.push(
      `| ${statusLabel(result.status)} | ${markdownCell(result.caseId)} | ${formatDuration(result.durationMs)} | ${markdownCell(evidenceLabel(result))} | ${markdownCell((result.capabilities ?? []).join(", "))} |`,
    );
  }

  const unsuccessful = report.results.filter(
    ({ status }) => status === "failed" || status === "error",
  );
  if (unsuccessful.length) {
    lines.push("", "## Failures");
    for (const result of unsuccessful) {
      lines.push("", `### ${result.caseId}`, "");
      if (result.status === "error") {
        lines.push(
          `Executor error: ${result.error?.name ?? "Error"}: ${result.error?.message ?? "Unknown error"}`,
        );
        continue;
      }
      const failedChecks = (result.checks ?? []).filter(
        ({ status }) => status === "failed",
      );
      for (const check of failedChecks) {
        lines.push(`- **${markdownInline(check.id)}:** ${markdownInline(check.message)}`);
        for (const diff of check.differences ?? []) {
          lines.push(
            `  - \`${markdownInline(diff.path)}\`: ${markdownInline(diff.message)}${formatExpectedActual(diff)}`,
          );
        }
      }
    }
  }

  if (report.coverage?.requiredCapabilityCount !== undefined) {
    lines.push(
      "",
      "## Coverage",
      "",
      `Required capabilities covered: **${report.coverage.coveredRequiredCapabilityCount}/${report.coverage.requiredCapabilityCount}**.`,
    );
  }
  appendMarkdownConfusionMatrices(lines, report.confusionMatrices);
  return `${lines.join("\n")}\n`;
}

export const renderMarkdownReport = emitMarkdownReport;

export function emitHtmlReport(input, options = {}) {
  const report = buildInteractionEvalReport(input, options);
  const title = options.title ?? "Airboard interaction eval report";
  const rows = report.results
    .map(
      (result) => `<tr>
  <td class="${xml(result.status)}">${xml(statusLabel(result.status))}</td>
  <td>${xml(result.title ? `${result.caseId}: ${result.title}` : result.caseId)}</td>
  <td>${xml(formatDuration(result.durationMs))}</td>
  <td>${xml(evidenceLabel(result))}</td>
  <td>${xml((result.capabilities ?? []).join(", "))}</td>
</tr>`,
    )
    .join("\n");
  const failures = report.results
    .filter(({ status }) => status === "failed" || status === "error")
    .map(
      (result) =>
        `<details><summary>${xml(result.title ? `${result.caseId}: ${result.title}` : result.caseId)}</summary><pre>${xml(
          result.status === "error"
            ? result.error?.message ?? "Executor error"
            : failureDetails(result),
        )}</pre></details>`,
    )
    .join("\n");
  const confusionMatrices = renderHtmlConfusionMatrices(
    report.confusionMatrices,
  );
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${xml(title)}</title>
  <style>
    body{font:15px/1.5 system-ui,sans-serif;max-width:1100px;margin:40px auto;padding:0 20px;color:#17202a}
    table{border-collapse:collapse;width:100%}th,td{padding:9px;border-bottom:1px solid #d9dee3;text-align:left}
    .passed{color:#08783d}.failed,.error{color:#b42318}.skipped{color:#667085}
    pre{white-space:pre-wrap;background:#f6f8fa;padding:12px;border-radius:6px}
  </style>
</head>
<body>
  <h1>${xml(title)}</h1>
  <p>Generated ${xml(report.generatedAt)}. <strong>${report.summary.passed}/${report.summary.total} passed</strong>; ${report.summary.failed} failed; ${report.summary.errors} errors.</p>
  <table><thead><tr><th>Status</th><th>Case</th><th>Duration</th><th>Evidence</th><th>Capabilities</th></tr></thead><tbody>
${rows}
  </tbody></table>
  ${confusionMatrices}
  ${failures}
</body>
</html>
`;
}

export const renderHtmlReport = emitHtmlReport;

function appendMarkdownConfusionMatrices(lines, matrices) {
  if (!matrices || typeof matrices !== "object") return;
  for (const [name, matrix] of Object.entries(matrices)) {
    if (!Array.isArray(matrix?.labels) || !matrix?.matrix) continue;
    lines.push(
      "",
      `## Confusion matrix: ${markdownInline(name)}`,
      "",
      `| Expected \\ Actual | ${matrix.labels.map(markdownCell).join(" | ")} |`,
      `| --- | ${matrix.labels.map(() => "---:").join(" | ")} |`,
    );
    for (const expected of matrix.labels) {
      lines.push(
        `| ${markdownCell(expected)} | ${matrix.labels
          .map((actual) => matrix.matrix?.[expected]?.[actual] ?? 0)
          .join(" | ")} |`,
      );
    }
  }
}

function renderHtmlConfusionMatrices(matrices) {
  if (!matrices || typeof matrices !== "object") return "";
  return Object.entries(matrices)
    .filter(([, matrix]) => Array.isArray(matrix?.labels) && matrix?.matrix)
    .map(
      ([name, matrix]) =>
        `<section><h2>Confusion matrix: ${xml(name)}</h2><table><thead><tr><th>Expected \\ Actual</th>${matrix.labels.map((label) => `<th>${xml(label)}</th>`).join("")}</tr></thead><tbody>${matrix.labels.map((expected) => `<tr><th>${xml(expected)}</th>${matrix.labels.map((actual) => `<td>${xml(matrix.matrix?.[expected]?.[actual] ?? 0)}</td>`).join("")}</tr>`).join("")}</tbody></table></section>`,
    )
    .join("\n");
}

function evidenceLabel(result) {
  const provenance = result.evidenceProvenance;
  if (!provenance) return "unspecified · diagnostic only";
  return `${provenance.class ?? "unspecified"} · ${
    provenance.releaseEligible === true ? "release eligible" : "diagnostic only"
  }`;
}

function failedMessage(result) {
  const failedChecks = (result.checks ?? []).filter(
    ({ status }) => status === "failed",
  );
  if (!failedChecks.length) return "Interaction evaluation failed";
  return failedChecks.map(({ id }) => id).join(", ");
}

function failureDetails(result) {
  return (result.checks ?? [])
    .filter(({ status }) => status === "failed")
    .flatMap((check) => [
      `${check.id}: ${check.message}`,
      ...(check.differences ?? []).map(
        (diff) =>
          `  ${diff.path}: ${diff.message}${plainExpectedActual(diff)}`,
      ),
    ])
    .join("\n");
}

function plainExpectedActual(diff) {
  const parts = [];
  if (Object.prototype.hasOwnProperty.call(diff, "expected")) {
    parts.push(`expected=${stringifyShort(diff.expected)}`);
  }
  if (Object.prototype.hasOwnProperty.call(diff, "actual")) {
    parts.push(`actual=${stringifyShort(diff.actual)}`);
  }
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function formatExpectedActual(diff) {
  const parts = [];
  if (Object.prototype.hasOwnProperty.call(diff, "expected")) {
    parts.push(`expected \`${markdownInline(stringifyShort(diff.expected))}\``);
  }
  if (Object.prototype.hasOwnProperty.call(diff, "actual")) {
    parts.push(`actual \`${markdownInline(stringifyShort(diff.actual))}\``);
  }
  return parts.length ? ` (${parts.join("; ")})` : "";
}

function stringifyShort(value) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function formatDuration(durationMs) {
  const value = Number.isFinite(durationMs) ? durationMs : 0;
  return value < 1000 ? `${value.toFixed(1)} ms` : `${(value / 1000).toFixed(2)} s`;
}

function seconds(durationMs) {
  const value = Number.isFinite(durationMs) ? durationMs : 0;
  return (value / 1000).toFixed(3);
}

function statusLabel(status) {
  if (status === "passed") return "PASS";
  if (status === "failed") return "FAIL";
  if (status === "error") return "ERROR";
  return "SKIP";
}

function markdownCell(value) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replace(/\r?\n/g, " ");
}

function markdownInline(value) {
  return String(value ?? "")
    .replace(/\r?\n/g, " ")
    .replaceAll("`", "\\`");
}

function xml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
