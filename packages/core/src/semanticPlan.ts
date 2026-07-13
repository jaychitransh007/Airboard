import { AIRBOARD_SEMANTIC_NODE_CAPABILITIES } from "./semanticCapabilities.ts";
import type { AnnotationNodeType } from "./types.ts";

export const AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION = "1.0" as const;
export const AIRBOARD_SEMANTIC_PLAN_TOOL_NAME = "propose_diagram_plan" as const;
export const AIRBOARD_SEMANTIC_PLAN_MAX_ACTIONS = 12;

export const SEMANTIC_PLAN_RESOLUTION_STATUSES = [
  "resolved",
  "clarification",
  "unsupported",
] as const;
export type SemanticPlanResolutionStatus =
  (typeof SEMANTIC_PLAN_RESOLUTION_STATUSES)[number];

export const SEMANTIC_PLAN_ISSUE_CODES = [
  "none",
  "ambiguous_reference",
  "missing_context",
  "missing_selection",
  "missing_pointer",
  "missing_label",
  "missing_source",
  "missing_target",
  "incomplete_request",
  "plan_too_large",
  "not_board_command",
  "unsupported_operation",
] as const;
export type SemanticPlanIssueCode = (typeof SEMANTIC_PLAN_ISSUE_CODES)[number];

export const SEMANTIC_PLAN_MISSING_SLOTS = [
  "node_type",
  "object_reference",
  "source",
  "target",
  "label",
  "branch_target",
  "branch_label",
  "placement",
  "selection",
  "pointer",
  "direction",
  "alignment",
  "distribution_axis",
  "layout",
] as const;
export type SemanticPlanMissingSlot = (typeof SEMANTIC_PLAN_MISSING_SLOTS)[number];

export type SemanticObjectReference =
  | { kind: "current_selection" }
  | { kind: "pointer" }
  | { kind: "visible_label"; label: string; occurrence: number | null }
  | { kind: "type_ordinal"; nodeType: AnnotationNodeType; ordinal: number }
  | { kind: "plan_handle"; handle: string };

export type SemanticPlacement =
  | { kind: "auto" }
  | { kind: "pointer" }
  | { kind: "canvas_region"; region: "center" | "left" | "right" | "top" | "bottom" }
  | {
      kind: "relative";
      anchor: SemanticObjectReference;
      direction: "left" | "right" | "above" | "below";
    }
  | {
      kind: "offset";
      direction: "left" | "right" | "above" | "below";
      distance: "small" | "medium" | "large";
    };

export type SemanticCreateAction = {
  type: "create";
  nodeType: AnnotationNodeType;
  label: string | null;
  handle: string;
  placement: SemanticPlacement;
};
export type SemanticConnectAction = {
  type: "connect";
  from: SemanticObjectReference;
  to: SemanticObjectReference;
  label: string | null;
};
export type SemanticBranchAction = {
  type: "branch";
  from: SemanticObjectReference;
  branches: Array<{ to: SemanticObjectReference; label: string | null }>;
};
export type SemanticRenameAction = {
  type: "rename";
  target: SemanticObjectReference;
  label: string;
};
export type SemanticDeleteAction = {
  type: "delete";
  targets: SemanticObjectReference[];
};
export type SemanticDuplicateAction = {
  type: "duplicate";
  targets: SemanticObjectReference[];
  placement: SemanticPlacement;
};
export type SemanticMoveAction = {
  type: "move";
  targets: SemanticObjectReference[];
  placement: SemanticPlacement;
};
export type SemanticAlignAction = {
  type: "align";
  targets: SemanticObjectReference[];
  alignment: "left" | "right" | "top" | "bottom" | "horizontal_center" | "vertical_center";
};
export type SemanticDistributeAction = {
  type: "distribute";
  targets: SemanticObjectReference[];
  axis: "horizontal" | "vertical";
};
export type SemanticLayoutAction = {
  type: "layout";
  targets: SemanticObjectReference[];
  direction: "left_to_right" | "right_to_left" | "top_to_bottom" | "bottom_to_top" | "grid";
};
export type SemanticGroupAction = {
  type: "group";
  targets: SemanticObjectReference[];
  label: string | null;
  handle: string;
};
export type SemanticSelectAction = {
  type: "select";
  targets: SemanticObjectReference[];
  mode: "replace" | "add" | "remove";
};
export type SemanticUndoAction = { type: "undo" };
export type SemanticCancelAction = { type: "cancel" };

export type SemanticPlanAction =
  | SemanticCreateAction
  | SemanticConnectAction
  | SemanticBranchAction
  | SemanticRenameAction
  | SemanticDeleteAction
  | SemanticDuplicateAction
  | SemanticMoveAction
  | SemanticAlignAction
  | SemanticDistributeAction
  | SemanticLayoutAction
  | SemanticGroupAction
  | SemanticSelectAction
  | SemanticUndoAction
  | SemanticCancelAction;

export type SemanticPlan = {
  version: typeof AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION;
  status: SemanticPlanResolutionStatus;
  issueCode: SemanticPlanIssueCode;
  clarificationQuestion: string | null;
  missingSlots: SemanticPlanMissingSlot[];
  actions: SemanticPlanAction[];
};

const nodeTypeEnum = AIRBOARD_SEMANTIC_NODE_CAPABILITIES.map(({ nodeType }) => nodeType);
const labelSchema = { type: "string", minLength: 1, maxLength: 120, pattern: "^[^\\u0000-\\u001F\\u007F]+$" } as const;
const nullableLabelSchema = { anyOf: [labelSchema, { type: "null" }] } as const;
const handleSchema = { type: "string", minLength: 1, maxLength: 64, pattern: "^[a-z][a-z0-9_-]*$" } as const;
const referenceArraySchema = {
  type: "array",
  minItems: 1,
  maxItems: 20,
  items: { $ref: "#/$defs/objectReference" },
} as const;

/** Strict schema used as the parameters of an OpenAI Responses API function tool. */
export const AIRBOARD_SEMANTIC_PLAN_JSON_SCHEMA = {
  type: "object",
  properties: {
    version: { type: "string", enum: [AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION] },
    status: { type: "string", enum: SEMANTIC_PLAN_RESOLUTION_STATUSES },
    issueCode: { type: "string", enum: SEMANTIC_PLAN_ISSUE_CODES },
    clarificationQuestion: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 240, pattern: "^[^\\u0000-\\u001F\\u007F]+$" },
        { type: "null" },
      ],
    },
    missingSlots: {
      type: "array",
      maxItems: 14,
      items: { type: "string", enum: SEMANTIC_PLAN_MISSING_SLOTS },
    },
    actions: {
      type: "array",
      maxItems: AIRBOARD_SEMANTIC_PLAN_MAX_ACTIONS,
      items: { $ref: "#/$defs/action" },
    },
  },
  required: ["version", "status", "issueCode", "clarificationQuestion", "missingSlots", "actions"],
  additionalProperties: false,
  $defs: {
    objectReference: {
      anyOf: [
        {
          type: "object",
          properties: { kind: { type: "string", enum: ["current_selection"] } },
          required: ["kind"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: { kind: { type: "string", enum: ["pointer"] } },
          required: ["kind"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["visible_label"] },
            label: labelSchema,
            occurrence: { anyOf: [{ type: "integer", minimum: 1, maximum: 20 }, { type: "null" }] },
          },
          required: ["kind", "label", "occurrence"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["type_ordinal"] },
            nodeType: { type: "string", enum: nodeTypeEnum },
            ordinal: { type: "integer", minimum: 1, maximum: 20 },
          },
          required: ["kind", "nodeType", "ordinal"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["plan_handle"] },
            handle: handleSchema,
          },
          required: ["kind", "handle"],
          additionalProperties: false,
        },
      ],
    },
    placement: {
      anyOf: [
        {
          type: "object",
          properties: { kind: { type: "string", enum: ["auto"] } },
          required: ["kind"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: { kind: { type: "string", enum: ["pointer"] } },
          required: ["kind"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["canvas_region"] },
            region: { type: "string", enum: ["center", "left", "right", "top", "bottom"] },
          },
          required: ["kind", "region"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["relative"] },
            anchor: { $ref: "#/$defs/objectReference" },
            direction: { type: "string", enum: ["left", "right", "above", "below"] },
          },
          required: ["kind", "anchor", "direction"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["offset"] },
            direction: { type: "string", enum: ["left", "right", "above", "below"] },
            distance: { type: "string", enum: ["small", "medium", "large"] },
          },
          required: ["kind", "direction", "distance"],
          additionalProperties: false,
        },
      ],
    },
    branchEdge: {
      type: "object",
      properties: {
        to: { $ref: "#/$defs/objectReference" },
        label: nullableLabelSchema,
      },
      required: ["to", "label"],
      additionalProperties: false,
    },
    action: {
      anyOf: [
        {
          type: "object",
          properties: {
            type: { type: "string", enum: ["create"] },
            nodeType: { type: "string", enum: nodeTypeEnum },
            label: nullableLabelSchema,
            handle: handleSchema,
            placement: { $ref: "#/$defs/placement" },
          },
          required: ["type", "nodeType", "label", "handle", "placement"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            type: { type: "string", enum: ["connect"] },
            from: { $ref: "#/$defs/objectReference" },
            to: { $ref: "#/$defs/objectReference" },
            label: nullableLabelSchema,
          },
          required: ["type", "from", "to", "label"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            type: { type: "string", enum: ["branch"] },
            from: { $ref: "#/$defs/objectReference" },
            branches: { type: "array", minItems: 2, maxItems: 8, items: { $ref: "#/$defs/branchEdge" } },
          },
          required: ["type", "from", "branches"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            type: { type: "string", enum: ["rename"] },
            target: { $ref: "#/$defs/objectReference" },
            label: labelSchema,
          },
          required: ["type", "target", "label"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: { type: { type: "string", enum: ["delete"] }, targets: referenceArraySchema },
          required: ["type", "targets"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            type: { type: "string", enum: ["duplicate"] },
            targets: referenceArraySchema,
            placement: { $ref: "#/$defs/placement" },
          },
          required: ["type", "targets", "placement"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            type: { type: "string", enum: ["move"] },
            targets: referenceArraySchema,
            placement: { $ref: "#/$defs/placement" },
          },
          required: ["type", "targets", "placement"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            type: { type: "string", enum: ["align"] },
            targets: referenceArraySchema,
            alignment: { type: "string", enum: ["left", "right", "top", "bottom", "horizontal_center", "vertical_center"] },
          },
          required: ["type", "targets", "alignment"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            type: { type: "string", enum: ["distribute"] },
            targets: referenceArraySchema,
            axis: { type: "string", enum: ["horizontal", "vertical"] },
          },
          required: ["type", "targets", "axis"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            type: { type: "string", enum: ["layout"] },
            targets: referenceArraySchema,
            direction: { type: "string", enum: ["left_to_right", "right_to_left", "top_to_bottom", "bottom_to_top", "grid"] },
          },
          required: ["type", "targets", "direction"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            type: { type: "string", enum: ["group"] },
            targets: referenceArraySchema,
            label: nullableLabelSchema,
            handle: handleSchema,
          },
          required: ["type", "targets", "label", "handle"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            type: { type: "string", enum: ["select"] },
            targets: referenceArraySchema,
            mode: { type: "string", enum: ["replace", "add", "remove"] },
          },
          required: ["type", "targets", "mode"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: { type: { type: "string", enum: ["undo"] } },
          required: ["type"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: { type: { type: "string", enum: ["cancel"] } },
          required: ["type"],
          additionalProperties: false,
        },
      ],
    },
  },
} as const;

export const AIRBOARD_SEMANTIC_PLAN_TOOL = {
  type: "function",
  name: AIRBOARD_SEMANTIC_PLAN_TOOL_NAME,
  description:
    "Resolve an activated Airboard voice turn into a safe, typed diagram plan or a clarification.",
  strict: true,
  parameters: AIRBOARD_SEMANTIC_PLAN_JSON_SCHEMA,
} as const;

export type SemanticPlanParseError = {
  code: "invalid_json" | "invalid_shape" | "invalid_value" | "inconsistent_plan";
  path: string;
  message: string;
};
export type SemanticPlanParseResult =
  | { ok: true; value: SemanticPlan }
  | { ok: false; error: SemanticPlanParseError };

export function parseSemanticPlan(input: unknown): SemanticPlanParseResult {
  const decoded = decodeInput(input);
  if (!decoded.ok) return decoded;
  const problem = validatePlan(decoded.value);
  return problem
    ? { ok: false, error: problem }
    : { ok: true, value: decoded.value as SemanticPlan };
}

function decodeInput(input: unknown): { ok: true; value: unknown } | { ok: false; error: SemanticPlanParseError } {
  if (typeof input !== "string") return { ok: true, value: input };
  if (input.length > 65_536) return failure("invalid_value", "$", "Plan JSON exceeds 65,536 characters.");
  try {
    return { ok: true, value: JSON.parse(input) as unknown };
  } catch {
    return failure("invalid_json", "$", "Plan output is not valid JSON.");
  }
}

function failure(code: SemanticPlanParseError["code"], path: string, message: string): { ok: false; error: SemanticPlanParseError } {
  return { ok: false, error: { code, path, message } };
}

function issue(code: SemanticPlanParseError["code"], path: string, message: string): SemanticPlanParseError {
  return { code, path, message };
}

function validatePlan(value: unknown): SemanticPlanParseError | null {
  if (!isExactRecord(value, ["version", "status", "issueCode", "clarificationQuestion", "missingSlots", "actions"])) {
    return issue("invalid_shape", "$", "Plan must contain exactly the documented root fields.");
  }
  if (value.version !== AIRBOARD_SEMANTIC_PLAN_CONTRACT_VERSION) return issue("invalid_value", "$.version", "Unsupported plan contract version.");
  if (!includes(SEMANTIC_PLAN_RESOLUTION_STATUSES, value.status)) return issue("invalid_value", "$.status", "Unknown resolution status.");
  if (!includes(SEMANTIC_PLAN_ISSUE_CODES, value.issueCode)) return issue("invalid_value", "$.issueCode", "Unknown issue code.");
  if (value.clarificationQuestion !== null && !validText(value.clarificationQuestion, 240)) return issue("invalid_value", "$.clarificationQuestion", "Clarification question is invalid.");
  if (!Array.isArray(value.missingSlots) || value.missingSlots.length > SEMANTIC_PLAN_MISSING_SLOTS.length) return issue("invalid_value", "$.missingSlots", "Missing slots must be a bounded array.");
  const seenSlots = new Set<string>();
  for (let index = 0; index < value.missingSlots.length; index += 1) {
    const slot = value.missingSlots[index];
    if (!includes(SEMANTIC_PLAN_MISSING_SLOTS, slot) || seenSlots.has(String(slot))) return issue("invalid_value", `$.missingSlots[${index}]`, "Missing slot is unknown or duplicated.");
    seenSlots.add(String(slot));
  }
  if (!Array.isArray(value.actions) || value.actions.length > AIRBOARD_SEMANTIC_PLAN_MAX_ACTIONS) return issue("invalid_value", "$.actions", "Actions must be a bounded array.");
  for (let index = 0; index < value.actions.length; index += 1) {
    const actionIssue = validateAction(value.actions[index], `$.actions[${index}]`);
    if (actionIssue) return actionIssue;
  }
  if (value.status === "resolved") {
    if (value.actions.length === 0) return issue("inconsistent_plan", "$.actions", "A resolved plan requires at least one action.");
    if (value.issueCode !== "none" || value.clarificationQuestion !== null || value.missingSlots.length !== 0) return issue("inconsistent_plan", "$", "A resolved plan cannot contain an issue, question, or missing slot.");
  } else {
    if (value.actions.length !== 0) return issue("inconsistent_plan", "$.actions", "An unresolved plan cannot contain actions.");
    if (value.issueCode === "none") return issue("inconsistent_plan", "$.issueCode", "An unresolved plan requires an issue code.");
    if (value.status === "clarification" && !validText(value.clarificationQuestion, 240)) return issue("inconsistent_plan", "$.clarificationQuestion", "Clarification requires a question.");
    if (value.status === "clarification" && value.missingSlots.length === 0) return issue("inconsistent_plan", "$.missingSlots", "Clarification requires at least one structured missing slot.");
    if (value.status === "unsupported" && value.clarificationQuestion !== null) return issue("inconsistent_plan", "$.clarificationQuestion", "Unsupported plans cannot ask a clarification question.");
  }
  return validatePlanHandles(value.actions as SemanticPlanAction[]);
}

function validateAction(value: unknown, path: string): SemanticPlanParseError | null {
  if (!isRecord(value) || typeof value.type !== "string") return issue("invalid_shape", path, "Action must be an object with a type.");
  switch (value.type) {
    case "create":
      if (!isExactRecord(value, ["type", "nodeType", "label", "handle", "placement"])) return shape(path);
      if (!isNodeType(value.nodeType) || !validNullableText(value.label, 120) || !validHandle(value.handle)) return issue("invalid_value", path, "Create action fields are invalid.");
      return validatePlacement(value.placement, `${path}.placement`);
    case "connect":
      if (!isExactRecord(value, ["type", "from", "to", "label"])) return shape(path);
      {
        const fieldIssue = validateReference(value.from, `${path}.from`) ?? validateReference(value.to, `${path}.to`) ?? (!validNullableText(value.label, 120) ? issue("invalid_value", `${path}.label`, "Connector label is invalid.") : null);
        if (fieldIssue) return fieldIssue;
        if (referenceKey(value.from as SemanticObjectReference) === referenceKey(value.to as SemanticObjectReference)) return issue("inconsistent_plan", path, "A connection cannot use the same source and target reference.");
        return null;
      }
    case "branch": {
      if (!isExactRecord(value, ["type", "from", "branches"])) return shape(path);
      const fromIssue = validateReference(value.from, `${path}.from`);
      if (fromIssue) return fromIssue;
      if (!Array.isArray(value.branches) || value.branches.length < 2 || value.branches.length > 8) return issue("invalid_value", `${path}.branches`, "Branch requires two to eight edges.");
      const endpointKeys = new Set<string>();
      for (let index = 0; index < value.branches.length; index += 1) {
        const edge = value.branches[index];
        if (!isExactRecord(edge, ["to", "label"])) return shape(`${path}.branches[${index}]`);
        const refIssue = validateReference(edge.to, `${path}.branches[${index}].to`);
        if (refIssue) return refIssue;
        if (!validNullableText(edge.label, 120)) return issue("invalid_value", `${path}.branches[${index}].label`, "Branch label is invalid.");
        const endpointKey = referenceKey(edge.to as SemanticObjectReference);
        if (endpointKey === referenceKey(value.from as SemanticObjectReference) || endpointKeys.has(endpointKey)) return issue("inconsistent_plan", `${path}.branches[${index}].to`, "Branch endpoints must be distinct from the source and each other.");
        endpointKeys.add(endpointKey);
      }
      return null;
    }
    case "rename":
      if (!isExactRecord(value, ["type", "target", "label"])) return shape(path);
      return validateReference(value.target, `${path}.target`) ?? (!validText(value.label, 120) ? issue("invalid_value", `${path}.label`, "Rename label is invalid.") : null);
    case "delete":
      if (!isExactRecord(value, ["type", "targets"])) return shape(path);
      return validateReferences(value.targets, `${path}.targets`, 1);
    case "duplicate":
    case "move":
      if (!isExactRecord(value, ["type", "targets", "placement"])) return shape(path);
      return validateReferences(value.targets, `${path}.targets`, 1) ?? validatePlacement(value.placement, `${path}.placement`);
    case "align":
      if (!isExactRecord(value, ["type", "targets", "alignment"])) return shape(path);
      return validateReferences(value.targets, `${path}.targets`, 2) ?? (!includes(["left", "right", "top", "bottom", "horizontal_center", "vertical_center"] as const, value.alignment) ? issue("invalid_value", `${path}.alignment`, "Alignment is invalid.") : null);
    case "distribute":
      if (!isExactRecord(value, ["type", "targets", "axis"])) return shape(path);
      return validateReferences(value.targets, `${path}.targets`, 3) ?? (!includes(["horizontal", "vertical"] as const, value.axis) ? issue("invalid_value", `${path}.axis`, "Distribution axis is invalid.") : null);
    case "layout":
      if (!isExactRecord(value, ["type", "targets", "direction"])) return shape(path);
      return validateReferences(value.targets, `${path}.targets`, 2) ?? (!includes(["left_to_right", "right_to_left", "top_to_bottom", "bottom_to_top", "grid"] as const, value.direction) ? issue("invalid_value", `${path}.direction`, "Layout direction is invalid.") : null);
    case "group":
      if (!isExactRecord(value, ["type", "targets", "label", "handle"])) return shape(path);
      return validateReferences(value.targets, `${path}.targets`, 1) ?? (!validNullableText(value.label, 120) || !validHandle(value.handle) ? issue("invalid_value", path, "Group fields are invalid.") : null);
    case "select":
      if (!isExactRecord(value, ["type", "targets", "mode"])) return shape(path);
      return validateReferences(value.targets, `${path}.targets`, 1) ?? (!includes(["replace", "add", "remove"] as const, value.mode) ? issue("invalid_value", `${path}.mode`, "Selection mode is invalid.") : null);
    case "undo":
    case "cancel":
      return isExactRecord(value, ["type"]) ? null : shape(path);
    default:
      return issue("invalid_value", `${path}.type`, "Unknown action type.");
  }
}

function validateReference(value: unknown, path: string): SemanticPlanParseError | null {
  if (!isRecord(value) || typeof value.kind !== "string") return issue("invalid_shape", path, "Object reference is invalid.");
  switch (value.kind) {
    case "current_selection":
    case "pointer":
      return isExactRecord(value, ["kind"]) ? null : shape(path);
    case "visible_label":
      if (!isExactRecord(value, ["kind", "label", "occurrence"])) return shape(path);
      return validText(value.label, 120) && (value.occurrence === null || validInteger(value.occurrence, 1, 20)) ? null : issue("invalid_value", path, "Visible-label reference is invalid.");
    case "type_ordinal":
      if (!isExactRecord(value, ["kind", "nodeType", "ordinal"])) return shape(path);
      return isNodeType(value.nodeType) && validInteger(value.ordinal, 1, 20) ? null : issue("invalid_value", path, "Type-ordinal reference is invalid.");
    case "plan_handle":
      if (!isExactRecord(value, ["kind", "handle"])) return shape(path);
      return validHandle(value.handle) ? null : issue("invalid_value", path, "Plan handle is invalid.");
    default:
      return issue("invalid_value", `${path}.kind`, "Unknown object-reference kind.");
  }
}

function validateReferences(value: unknown, path: string, minimum: number): SemanticPlanParseError | null {
  if (!Array.isArray(value) || value.length < minimum || value.length > 20) return issue("invalid_value", path, `Expected ${minimum} to 20 object references.`);
  for (let index = 0; index < value.length; index += 1) {
    const refIssue = validateReference(value[index], `${path}[${index}]`);
    if (refIssue) return refIssue;
  }
  return null;
}

function validatePlacement(value: unknown, path: string): SemanticPlanParseError | null {
  if (!isRecord(value) || typeof value.kind !== "string") return issue("invalid_shape", path, "Placement is invalid.");
  switch (value.kind) {
    case "auto":
    case "pointer":
      return isExactRecord(value, ["kind"]) ? null : shape(path);
    case "canvas_region":
      if (!isExactRecord(value, ["kind", "region"])) return shape(path);
      return includes(["center", "left", "right", "top", "bottom"] as const, value.region) ? null : issue("invalid_value", `${path}.region`, "Canvas region is invalid.");
    case "relative":
      if (!isExactRecord(value, ["kind", "anchor", "direction"])) return shape(path);
      return validateReference(value.anchor, `${path}.anchor`) ?? (!includes(["left", "right", "above", "below"] as const, value.direction) ? issue("invalid_value", `${path}.direction`, "Relative direction is invalid.") : null);
    case "offset":
      if (!isExactRecord(value, ["kind", "direction", "distance"])) return shape(path);
      if (!includes(["left", "right", "above", "below"] as const, value.direction) || !includes(["small", "medium", "large"] as const, value.distance)) return issue("invalid_value", path, "Offset placement is invalid.");
      return null;
    default:
      return issue("invalid_value", `${path}.kind`, "Unknown placement kind.");
  }
}

function validatePlanHandles(actions: SemanticPlanAction[]): SemanticPlanParseError | null {
  const declared = new Set<string>();
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index]!;
    for (const ref of referencesInAction(action)) {
      if (ref.kind === "plan_handle" && !declared.has(ref.handle)) return issue("inconsistent_plan", `$.actions[${index}]`, `Plan handle '${ref.handle}' must be declared by an earlier action.`);
    }
    if (action.type === "create" || action.type === "group") {
      if (declared.has(action.handle)) return issue("inconsistent_plan", `$.actions[${index}].handle`, "Plan handles must be unique.");
      declared.add(action.handle);
    }
    if ((action.type === "undo" || action.type === "cancel") && actions.length !== 1) return issue("inconsistent_plan", `$.actions[${index}]`, `${action.type} must be the only action in a plan.`);
  }
  return null;
}

function referencesInAction(action: SemanticPlanAction): SemanticObjectReference[] {
  const placementReferences = (placement: SemanticPlacement): SemanticObjectReference[] => placement.kind === "relative" ? [placement.anchor] : [];
  switch (action.type) {
    case "create": return placementReferences(action.placement);
    case "connect": return [action.from, action.to];
    case "branch": return [action.from, ...action.branches.map(({ to }) => to)];
    case "rename": return [action.target];
    case "delete":
    case "align":
    case "distribute":
    case "layout":
    case "group":
    case "select": return action.targets;
    case "duplicate":
    case "move": return [...action.targets, ...placementReferences(action.placement)];
    case "undo":
    case "cancel": return [];
  }
}

function referenceKey(reference: SemanticObjectReference): string {
  switch (reference.kind) {
    case "current_selection": return "current_selection";
    case "pointer": return "pointer";
    case "visible_label": return `visible_label:${reference.label.toLocaleLowerCase()}:${reference.occurrence ?? "any"}`;
    case "type_ordinal": return `type_ordinal:${reference.nodeType}:${reference.ordinal}`;
    case "plan_handle": return `plan_handle:${reference.handle}`;
  }
}

function shape(path: string): SemanticPlanParseError { return issue("invalid_shape", path, "Object contains missing or undocumented fields."); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
function includes<const T extends readonly unknown[]>(values: T, value: unknown): value is T[number] { return values.includes(value); }
function validInteger(value: unknown, minimum: number, maximum: number): value is number { return typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum; }
function validHandle(value: unknown): value is string { return typeof value === "string" && /^[a-z][a-z0-9_-]{0,63}$/u.test(value); }
function validText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= maximum && value === value.trim() && !/[\u0000-\u001F\u007F]/u.test(value);
}
function validNullableText(value: unknown, maximum: number): value is string | null { return value === null || validText(value, maximum); }
function isNodeType(value: unknown): value is AnnotationNodeType { return nodeTypeEnum.includes(value as AnnotationNodeType); }
