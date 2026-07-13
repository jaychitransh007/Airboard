/**
 * The intent pipeline's grounding core: pure functions that turn parsed
 * commands (deterministic grammar) and semantic plans (LLM) into concrete
 * DiagramCommands against a board snapshot, plus the staleness policy that
 * decides when a snapshot no longer matches the live board. Extracted from
 * AirboardPrototype so every grounding and staleness rule is unit-testable
 * without React. Nothing in this module may touch component state.
 */

import {
  AIRBOARD_SEMANTIC_NODE_CAPABILITIES,
  type AnnotationPoint,
  type BoardState,
  type DiagramCommand,
  type SemanticObjectReference,
  type SemanticPlacement,
  type SemanticPlanAction,
  type StrokeAnnotation,
} from "@airboard/core";
import { findAnnotationObjectAtPoint } from "@airboard/drawing-engine";
import type { IntentCanvasOperation } from "./intentCanvasParser.ts";
import type { SemanticIntentContext } from "./semanticIntent.ts";

/**
 * Cursor-presence events replace the BoardState object dozens of times per
 * second while a hand or pointer is moving, so object identity is useless as
 * a staleness signal — it would reject every semantic plan while the camera
 * is live. Grounding only cares about committed diagram content: the reducer
 * replaces `strokes` on every commit/label/erase/delete/restore/clear and
 * preserves it for cursor and in-flight ink events.
 */
export function boardContentChanged(a: BoardState, b: BoardState): boolean {
  return a.strokes !== b.strokes || a.clearedAt !== b.clearedAt;
}

export type IntentResolutionContext = {
  boardState: BoardState;
  pointer: AnnotationPoint;
  canvasWidth: number;
  canvasHeight: number;
  selectionIds: string[];
  primarySelectionId: string | null;
  hoverStrokeId: string | null;
  strokeColor: string;
};

type IntentResolution =
  | {
      commands: DiagramCommand[];
      selectionAfter?: string[];
      previewStrokeId?: string | undefined;
    }
  | { error: string };

export type SemanticIntentResolutionContext = IntentResolutionContext & {
  pointerAvailable: boolean;
};

type SemanticActionResolution =
  | {
      commands: DiagramCommand[];
      selectionAfter?: string[];
      handleAssignments?: Record<string, string[]>;
    }
  | { error: string };

export function resolveSemanticPlanAction(
  action: SemanticPlanAction,
  context: SemanticIntentResolutionContext,
  planHandles: ReadonlyMap<string, string[]>,
): SemanticActionResolution {
  const resolveOne = (reference: SemanticObjectReference) =>
    resolveSingleSemanticReference(reference, context, planHandles);
  const resolveMany = (references: SemanticObjectReference[]) =>
    resolveSemanticTargets(references, context, planHandles);

  switch (action.type) {
    case "create": {
      const center = resolveSemanticCreateCenter(action.placement, context, planHandles);
      if ("error" in center) {
        return center;
      }
      const nodeId = crypto.randomUUID();
      return {
        commands: [
          {
            type: "node.create",
            nodeId,
            nodeType: action.nodeType,
            label: action.label ?? defaultNodeLabel(action.nodeType),
            center: center.point,
            source: "voice",
            style: { strokeColor: context.strokeColor },
          },
        ],
        selectionAfter: [nodeId],
        handleAssignments: { [action.handle]: [nodeId] },
      };
    }
    case "connect": {
      const from = resolveOne(action.from);
      if ("error" in from) return from;
      const to = resolveOne(action.to);
      if ("error" in to) return to;
      if (from.id === to.id) {
        return { error: "The source and target resolve to the same object." };
      }
      return {
        commands: [semanticConnectCommand(from.id, to.id, action.label, context.strokeColor)],
        selectionAfter: [from.id, to.id],
      };
    }
    case "branch": {
      const from = resolveOne(action.from);
      if ("error" in from) return from;
      const commands: DiagramCommand[] = [];
      const targetIds: string[] = [];
      for (const branch of action.branches) {
        const to = resolveOne(branch.to);
        if ("error" in to) return to;
        if (to.id === from.id) {
          return { error: "A decision branch cannot point back to its source object." };
        }
        commands.push(semanticConnectCommand(from.id, to.id, branch.label, context.strokeColor));
        targetIds.push(to.id);
      }
      if (new Set(targetIds).size !== targetIds.length) {
        return { error: "Each decision branch must target a distinct object." };
      }
      return { commands, selectionAfter: [from.id, ...targetIds] };
    }
    case "rename": {
      const target = resolveOne(action.target);
      return "error" in target
        ? target
        : {
            commands: [{ type: "object.rename", objectId: target.id, label: action.label }],
            selectionAfter: [target.id],
          };
    }
    case "delete": {
      const targets = resolveMany(action.targets);
      return "error" in targets
        ? targets
        : { commands: [{ type: "objects.delete", objectIds: targets.ids }], selectionAfter: [] };
    }
    case "duplicate": {
      const targets = resolveMany(action.targets);
      if ("error" in targets) return targets;
      const idMap = Object.fromEntries(targets.ids.map((id) => [id, crypto.randomUUID()]));
      const duplicatedIds = targets.ids.map((id) => idMap[id]!).filter(Boolean);
      const placement = semanticPlacementCommands(
        action.placement,
        targets.ids,
        duplicatedIds,
        context,
        planHandles,
        true,
      );
      if ("error" in placement) return placement;
      return {
        commands: [
          {
            type: "objects.duplicate",
            objectIds: targets.ids,
            idMap,
            offset: placement.duplicateOffset,
          },
          ...placement.commands,
        ],
        selectionAfter: duplicatedIds,
      };
    }
    case "move": {
      const targets = resolveMany(action.targets);
      if ("error" in targets) return targets;
      const placement = semanticPlacementCommands(
        action.placement,
        targets.ids,
        targets.ids,
        context,
        planHandles,
        false,
      );
      if ("error" in placement) return placement;
      return { commands: placement.commands, selectionAfter: targets.ids };
    }
    case "align": {
      const targets = resolveMany(action.targets);
      if ("error" in targets) return targets;
      if (targets.ids.length < 2) return { error: "Align requires at least two objects." };
      const alignment = {
        left: "left",
        right: "right",
        top: "top",
        bottom: "bottom",
        horizontal_center: "center-x",
        vertical_center: "center-y",
      }[action.alignment] as Extract<DiagramCommand, { type: "objects.align" }>["alignment"];
      return {
        commands: [{ type: "objects.align", objectIds: targets.ids, alignment }],
        selectionAfter: targets.ids,
      };
    }
    case "distribute": {
      const targets = resolveMany(action.targets);
      if ("error" in targets) return targets;
      if (targets.ids.length < 3) return { error: "Distribution requires at least three objects." };
      return {
        commands: [
          {
            type: "objects.align",
            objectIds: targets.ids,
            alignment: action.axis === "horizontal" ? "distribute-x" : "distribute-y",
          },
        ],
        selectionAfter: targets.ids,
      };
    }
    case "layout": {
      const targets = resolveMany(action.targets);
      if ("error" in targets) return targets;
      if (targets.ids.length < 2) return { error: "Layout requires at least two objects." };
      return {
        commands: createLayoutCommands(context.boardState, targets.ids, action.direction),
        selectionAfter: targets.ids,
      };
    }
    case "group": {
      const targets = resolveMany(action.targets);
      if ("error" in targets) return targets;
      const groupId = crypto.randomUUID();
      return {
        commands: [
          {
            type: "objects.group",
            groupId,
            objectIds: targets.ids,
            ...(action.label ? { label: action.label } : {}),
            source: "voice",
            style: { strokeColor: context.strokeColor },
          },
        ],
        selectionAfter: [groupId],
        handleAssignments: { [action.handle]: [groupId] },
      };
    }
    case "select": {
      const targets = resolveMany(action.targets);
      if ("error" in targets) return targets;
      const current = context.selectionIds.filter(
        (id) => context.boardState.strokes[id]?.status === "committed",
      );
      const next =
        action.mode === "replace"
          ? targets.ids
          : action.mode === "add"
            ? [...new Set([...current, ...targets.ids])]
            : current.filter((id) => !targets.ids.includes(id));
      return { commands: [], selectionAfter: next };
    }
    case "undo":
    case "cancel":
      return { error: "Undo and cancel are handled immediately." };
  }
}

function semanticConnectCommand(
  fromId: string,
  toId: string,
  label: string | null,
  strokeColor: string,
): DiagramCommand {
  return {
    type: "nodes.connect",
    connectorId: crypto.randomUUID(),
    fromId,
    toId,
    ...(label ? { label } : {}),
    source: "voice",
    style: { strokeColor },
  };
}

function resolveSingleSemanticReference(
  reference: SemanticObjectReference,
  context: SemanticIntentResolutionContext,
  planHandles: ReadonlyMap<string, string[]>,
): { id: string } | { error: string } {
  const resolved = resolveSemanticReference(reference, context, planHandles);
  if ("error" in resolved) return resolved;
  if (resolved.ids.length !== 1) {
    return { error: `That reference resolves to ${resolved.ids.length} objects; name one object or give its ordinal.` };
  }
  return { id: resolved.ids[0]! };
}

function resolveSemanticTargets(
  references: SemanticObjectReference[],
  context: SemanticIntentResolutionContext,
  planHandles: ReadonlyMap<string, string[]>,
): { ids: string[] } | { error: string } {
  const ids: string[] = [];
  for (const reference of references) {
    const resolved = resolveSemanticReference(reference, context, planHandles);
    if ("error" in resolved) return resolved;
    ids.push(...resolved.ids);
  }
  const unique = [...new Set(ids)];
  return unique.length > 0 ? { ids: unique } : { error: "No board objects matched that reference." };
}

function resolveSemanticReference(
  reference: SemanticObjectReference,
  context: SemanticIntentResolutionContext,
  planHandles: ReadonlyMap<string, string[]>,
): { ids: string[] } | { error: string } {
  const isNode = (id: string | null | undefined): id is string => {
    const annotation = id ? context.boardState.strokes[id]?.annotation : undefined;
    return Boolean(
      id &&
        context.boardState.strokes[id]?.status === "committed" &&
        annotation?.bounds &&
        annotation.type !== "connector" &&
        annotation.type !== "arrow",
    );
  };
  switch (reference.kind) {
    case "current_selection": {
      const ids = context.selectionIds.filter(isNode);
      return ids.length > 0 ? { ids } : { error: "There is no current object selection." };
    }
    case "pointer": {
      if (isNode(context.hoverStrokeId)) return { ids: [context.hoverStrokeId] };
      if (!context.pointerAvailable) {
        return { error: "No live pointer target is available. Point at an object and try again." };
      }
      const hit = findAnnotationObjectAtPoint(context.boardState, context.pointer);
      return isNode(hit?.id)
        ? { ids: [hit.id] }
        : { error: "The pointer is not currently over a diagram object." };
    }
    case "plan_handle": {
      const ids = (planHandles.get(reference.handle) ?? []).filter(isNode);
      return ids.length > 0
        ? { ids }
        : { error: `The generated plan referenced “${reference.handle}” before creating it.` };
    }
    case "visible_label": {
      const lookup = normalizeObjectLookup(reference.label);
      const matches = spatialSemanticNodes(context.boardState).filter(
        (entry) => normalizeObjectLookup(entry.label) === lookup,
      );
      if (matches.length === 0) {
        return { error: `I couldn’t find the visible label “${reference.label}”.` };
      }
      if (reference.occurrence !== null) {
        const match = matches[reference.occurrence - 1];
        return match
          ? { ids: [match.id] }
          : { error: `There is no occurrence ${reference.occurrence} of “${reference.label}”.` };
      }
      return matches.length === 1
        ? { ids: [matches[0]!.id] }
        : { error: `“${reference.label}” matches ${matches.length} objects; specify its occurrence.` };
    }
    case "type_ordinal": {
      const matches = spatialSemanticNodes(context.boardState).filter(
        (entry) => entry.nodeType === reference.nodeType,
      );
      const match = matches[reference.ordinal - 1];
      return match
        ? { ids: [match.id] }
        : { error: `There is no ${reference.nodeType} number ${reference.ordinal} on the board.` };
    }
  }
}

type SpatialSemanticNode = {
  id: string;
  label: string;
  nodeType: string;
  bounds: NonNullable<StrokeAnnotation["bounds"]>;
};

function spatialSemanticNodes(state: BoardState): SpatialSemanticNode[] {
  return Object.values(state.strokes)
    .flatMap((stroke): SpatialSemanticNode[] => {
      const annotation = stroke.annotation;
      if (
        stroke.status !== "committed" ||
        !annotation?.bounds ||
        annotation.type === "connector" ||
        annotation.type === "arrow"
      ) {
        return [];
      }
      const nodeType = annotation.nodeType ?? annotation.type;
      return [
        {
          id: stroke.id,
          label: annotation.label?.trim() || nodeType,
          nodeType,
          bounds: annotation.bounds,
        },
      ];
    })
    .sort((left, right) => {
      const leftY = left.bounds.y + left.bounds.height / 2;
      const rightY = right.bounds.y + right.bounds.height / 2;
      const leftX = left.bounds.x + left.bounds.width / 2;
      const rightX = right.bounds.x + right.bounds.width / 2;
      return leftY - rightY || leftX - rightX || left.id.localeCompare(right.id);
    });
}

function resolveSemanticCreateCenter(
  placement: SemanticPlacement,
  context: SemanticIntentResolutionContext,
  planHandles: ReadonlyMap<string, string[]>,
): { point: AnnotationPoint } | { error: string } {
  if (placement.kind === "auto") {
    const index = planHandles.size;
    return {
      point: {
        x: clampNumber(context.pointer.x + (index % 3) * 184, 100, context.canvasWidth - 100),
        y: clampNumber(context.pointer.y + Math.floor(index / 3) * 120, 70, context.canvasHeight - 70),
      },
    };
  }
  if (placement.kind === "pointer") {
    return context.pointerAvailable
      ? { point: context.pointer }
      : { error: "This placement requires a live hand pointer." };
  }
  if (placement.kind === "canvas_region") {
    return { point: semanticCanvasRegionCenter(placement.region, context) };
  }
  if (placement.kind === "offset") {
    const delta = semanticOffsetDelta(placement.direction, placement.distance);
    return { point: { x: context.pointer.x + delta.x, y: context.pointer.y + delta.y } };
  }
  const anchor = resolveSingleSemanticReference(placement.anchor, context, planHandles);
  if ("error" in anchor) return anchor;
  const bounds = context.boardState.strokes[anchor.id]?.annotation?.bounds;
  if (!bounds) return { error: "The relative-placement anchor has no bounds." };
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  const gapX = bounds.width / 2 + 126;
  const gapY = bounds.height / 2 + 92;
  return {
    point:
      placement.direction === "left"
        ? { x: center.x - gapX, y: center.y }
        : placement.direction === "right"
          ? { x: center.x + gapX, y: center.y }
          : placement.direction === "above"
            ? { x: center.x, y: center.y - gapY }
            : { x: center.x, y: center.y + gapY },
  };
}

function semanticPlacementCommands(
  placement: SemanticPlacement,
  sourceIds: string[],
  resultIds: string[],
  context: SemanticIntentResolutionContext,
  planHandles: ReadonlyMap<string, string[]>,
  duplicate: boolean,
): { commands: DiagramCommand[]; duplicateOffset: AnnotationPoint } | { error: string } {
  if (placement.kind === "auto") {
    const delta = { x: 32, y: 32 };
    return duplicate
      ? { commands: [], duplicateOffset: delta }
      : { commands: [{ type: "objects.move", objectIds: resultIds, delta }], duplicateOffset: { x: 0, y: 0 } };
  }
  if (placement.kind === "offset") {
    const delta = semanticOffsetDelta(placement.direction, placement.distance);
    return duplicate
      ? { commands: [], duplicateOffset: delta }
      : { commands: [{ type: "objects.move", objectIds: resultIds, delta }], duplicateOffset: { x: 0, y: 0 } };
  }
  const bounds = semanticSelectionBounds(context.boardState, sourceIds);
  if (!bounds) return { error: "The objects being placed have no bounds." };
  let targetCenter: AnnotationPoint;
  if (placement.kind === "pointer") {
    if (!context.pointerAvailable) return { error: "This placement requires a live hand pointer." };
    targetCenter = context.pointer;
  } else if (placement.kind === "canvas_region") {
    targetCenter = semanticCanvasRegionCenter(placement.region, context);
  } else {
    const anchor = resolveSingleSemanticReference(placement.anchor, context, planHandles);
    if ("error" in anchor) return anchor;
    const anchorBounds = context.boardState.strokes[anchor.id]?.annotation?.bounds;
    if (!anchorBounds) return { error: "The relative-placement anchor has no bounds." };
    const anchorCenter = {
      x: anchorBounds.x + anchorBounds.width / 2,
      y: anchorBounds.y + anchorBounds.height / 2,
    };
    targetCenter =
      placement.direction === "left"
        ? { x: anchorCenter.x - anchorBounds.width / 2 - bounds.width / 2 - 48, y: anchorCenter.y }
        : placement.direction === "right"
          ? { x: anchorCenter.x + anchorBounds.width / 2 + bounds.width / 2 + 48, y: anchorCenter.y }
          : placement.direction === "above"
            ? { x: anchorCenter.x, y: anchorCenter.y - anchorBounds.height / 2 - bounds.height / 2 - 44 }
            : { x: anchorCenter.x, y: anchorCenter.y + anchorBounds.height / 2 + bounds.height / 2 + 44 };
  }
  const command: DiagramCommand = {
    type: "objects.move",
    objectIds: resultIds,
    to: { x: targetCenter.x - bounds.width / 2, y: targetCenter.y - bounds.height / 2 },
  };
  return { commands: [command], duplicateOffset: { x: 0, y: 0 } };
}

function semanticCanvasRegionCenter(
  region: Extract<SemanticPlacement, { kind: "canvas_region" }>["region"],
  context: Pick<SemanticIntentResolutionContext, "canvasWidth" | "canvasHeight">,
): AnnotationPoint {
  const x = region === "left" ? 0.25 : region === "right" ? 0.75 : 0.5;
  const y = region === "top" ? 0.25 : region === "bottom" ? 0.75 : 0.5;
  return { x: context.canvasWidth * x, y: context.canvasHeight * y };
}

function semanticOffsetDelta(
  direction: Extract<SemanticPlacement, { kind: "offset" }>["direction"],
  distance: Extract<SemanticPlacement, { kind: "offset" }>["distance"],
): AnnotationPoint {
  const amount = distance === "small" ? 48 : distance === "large" ? 180 : 96;
  return direction === "left"
    ? { x: -amount, y: 0 }
    : direction === "right"
      ? { x: amount, y: 0 }
      : direction === "above"
        ? { x: 0, y: -amount }
        : { x: 0, y: amount };
}

function semanticSelectionBounds(
  state: BoardState,
  ids: string[],
): NonNullable<StrokeAnnotation["bounds"]> | null {
  const bounds = ids.flatMap((id) => {
    const value = state.strokes[id]?.annotation?.bounds;
    return value ? [value] : [];
  });
  if (bounds.length === 0) return null;
  const minX = Math.min(...bounds.map((value) => value.x));
  const minY = Math.min(...bounds.map((value) => value.y));
  const maxX = Math.max(...bounds.map((value) => value.x + value.width));
  const maxY = Math.max(...bounds.map((value) => value.y + value.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function describeSemanticPlan(actions: SemanticPlanAction[]): string {
  if (actions.length > 1) {
    return `Build and edit the diagram with ${actions.length} coordinated actions.`;
  }
  const action = actions[0];
  if (!action) return "Apply the diagram plan.";
  switch (action.type) {
    case "create":
      return `Create ${action.label ? `“${action.label}”` : `a ${action.nodeType}`} node.`;
    case "connect":
      return `Connect two diagram objects${action.label ? ` as “${action.label}”` : ""}.`;
    case "branch":
      return `Create ${action.branches.length} labelled decision branches.`;
    case "rename":
      return `Rename the referenced object to “${action.label}”.`;
    case "delete":
      return "Delete the referenced diagram objects.";
    case "duplicate":
      return "Duplicate the referenced diagram objects.";
    case "move":
      return "Move the referenced diagram objects.";
    case "align":
      return `Align the referenced objects ${action.alignment.replaceAll("_", " ")}.`;
    case "distribute":
      return `Distribute the referenced objects ${action.axis}.`;
    case "layout":
      return `Lay out the referenced objects ${action.direction.replaceAll("_", " ")}.`;
    case "group":
      return "Group the referenced diagram objects.";
    case "select":
      return "Update the diagram selection.";
    case "undo":
      return "Undo the last board action.";
    case "cancel":
      return "Cancel the pending board action.";
  }
}

export function resolveIntentOperation(
  operation: IntentCanvasOperation,
  context: IntentResolutionContext,
): IntentResolution {
  const selectionIds = context.selectionIds.filter(
    (strokeId) => context.boardState.strokes[strokeId]?.status === "committed",
  );
  const primarySelectionId =
    context.primarySelectionId && selectionIds.includes(context.primarySelectionId)
      ? context.primarySelectionId
      : (selectionIds[selectionIds.length - 1] ?? null);

  switch (operation.kind) {
    case "create_node": {
      const center = resolvePlacementCenter(operation.placement, {
        ...context,
        selectionIds,
        primarySelectionId,
      });
      if (!center) {
        return { error: "Point to a location or select the object this node should be placed beside." };
      }

      const ids = Array.from({ length: operation.count }, () => crypto.randomUUID());
      const maxCenterX = Math.max(90, context.canvasWidth - 90);
      const maxCenterY = Math.max(60, context.canvasHeight - 60);
      const minCenterX = Math.min(220, maxCenterX);
      const minCenterY = Math.min(220, maxCenterY);
      const availableWidth = Math.max(0, maxCenterX - minCenterX);
      const availableHeight = Math.max(0, maxCenterY - minCenterY);
      const preferredColumns =
        operation.count <= 4 ? operation.count : Math.ceil(Math.sqrt(operation.count));
      const columns = Math.min(
        preferredColumns,
        Math.max(1, Math.floor(availableWidth / 170) + 1),
      );
      const rows = Math.ceil(operation.count / Math.max(columns, 1));
      const spacingX = columns > 1 ? Math.min(190, availableWidth / (columns - 1)) : 0;
      const spacingY = rows > 1 ? Math.min(124, availableHeight / (rows - 1)) : 0;
      const groupWidth = (Math.min(operation.count, columns) - 1) * spacingX;
      const groupHeight = (rows - 1) * spacingY;
      const startX = clampNumber(
        center.x - groupWidth / 2,
        minCenterX,
        Math.max(minCenterX, maxCenterX - groupWidth),
      );
      const startY = clampNumber(
        center.y - groupHeight / 2,
        minCenterY,
        Math.max(minCenterY, maxCenterY - groupHeight),
      );
      const commands: DiagramCommand[] = ids.map((nodeId, index) => {
        const column = index % Math.max(columns, 1);
        const row = Math.floor(index / Math.max(columns, 1));
        const baseLabel = operation.label ?? defaultNodeLabel(operation.nodeType);
        const label = operation.count > 1 ? `${baseLabel} ${index + 1}` : baseLabel;
        return {
          type: "node.create",
          nodeId,
          nodeType: operation.nodeType,
          label,
          center: {
            x: startX + column * spacingX,
            y: startY + row * spacingY,
          },
          source: "voice",
          style: {
            strokeColor: context.strokeColor,
          },
        };
      });
      return {
        commands,
        selectionAfter: ids,
        previewStrokeId: ids[0],
      };
    }

    case "connect": {
      const deictic = resolveDeicticIds({
        boardState: context.boardState,
        selectionIds,
        primarySelectionId,
        hoverStrokeId: context.hoverStrokeId,
      });
      const from = resolveConnectionReference(operation.from, context.boardState, deictic);
      if ("error" in from) {
        return from;
      }
      const to = resolveConnectionReference(operation.to, context.boardState, deictic);
      if ("error" in to) {
        return to;
      }
      const fromId = from.id;
      const toId = to.id;
      if (fromId === toId) {
        return { error: "The source and target must be different objects." };
      }
      const connectorId = crypto.randomUUID();
      return {
        commands: [
          {
            type: "nodes.connect",
            connectorId,
            fromId,
            toId,
            ...(operation.label ? { label: operation.label } : {}),
            source: "voice",
            style: { strokeColor: context.strokeColor },
          },
        ],
        selectionAfter: [fromId],
        previewStrokeId: connectorId,
      };
    }

    case "rename_object": {
      const deictic = resolveDeicticIds({
        boardState: context.boardState,
        selectionIds,
        primarySelectionId,
        hoverStrokeId: context.hoverStrokeId,
      });
      const target = resolveConnectionReference(operation.target, context.boardState, deictic);
      if ("error" in target) {
        return target;
      }
      return {
        commands: [
          {
            type: "object.rename",
            objectId: target.id,
            label: operation.label,
          },
        ],
        selectionAfter: [target.id],
        previewStrokeId: target.id,
      };
    }

    case "rename_selection": {
      if (!primarySelectionId) {
        return { error: "Select one object before renaming it." };
      }
      return {
        commands: [
          {
            type: "object.rename",
            objectId: primarySelectionId,
            label: operation.label,
          },
        ],
        selectionAfter: selectionIds,
        previewStrokeId: primarySelectionId,
      };
    }

    case "delete_selection":
      return selectionIds.length > 0
        ? {
            commands: [{ type: "objects.delete", objectIds: selectionIds }],
            selectionAfter: [],
          }
        : { error: "Select one or more objects before deleting them." };

    case "duplicate_selection": {
      if (selectionIds.length === 0) {
        return { error: "Select one or more objects before duplicating them." };
      }
      const idMap = Object.fromEntries(selectionIds.map((strokeId) => [strokeId, crypto.randomUUID()]));
      const duplicatedIds = selectionIds.map((strokeId) => idMap[strokeId]).filter(Boolean) as string[];
      return {
        commands: [
          {
            type: "objects.duplicate",
            objectIds: selectionIds,
            idMap,
            offset: { x: 32, y: 32 },
          },
        ],
        selectionAfter: duplicatedIds,
        previewStrokeId: duplicatedIds[duplicatedIds.length - 1],
      };
    }

    case "move_selection": {
      if (selectionIds.length === 0) {
        return { error: "Select one or more objects before moving them." };
      }
      const deltaByDirection: Record<typeof operation.direction, AnnotationPoint> = {
        left: { x: -96, y: 0 },
        right: { x: 96, y: 0 },
        above: { x: 0, y: -80 },
        below: { x: 0, y: 80 },
      };
      return {
        commands: [
          {
            type: "objects.move",
            objectIds: selectionIds,
            delta: deltaByDirection[operation.direction],
          },
        ],
        selectionAfter: selectionIds,
        previewStrokeId: primarySelectionId ?? selectionIds[0],
      };
    }

    case "align_selection": {
      if (selectionIds.length < 2) {
        return { error: "Shift-click at least two objects before aligning them." };
      }
      const alignment =
        operation.alignment.axis === "x"
          ? operation.alignment.anchor === "minimum"
            ? "left"
            : operation.alignment.anchor === "maximum"
              ? "right"
              : "center-x"
          : operation.alignment.anchor === "minimum"
            ? "top"
            : operation.alignment.anchor === "maximum"
              ? "bottom"
              : "center-y";
      return {
        commands: [{ type: "objects.align", objectIds: selectionIds, alignment }],
        selectionAfter: selectionIds,
        previewStrokeId: primarySelectionId ?? selectionIds[0],
      };
    }

    case "distribute_selection":
      return selectionIds.length >= 3
        ? {
            commands: [
              {
                type: "objects.align",
                objectIds: selectionIds,
                alignment: operation.axis === "x" ? "distribute-x" : "distribute-y",
              },
            ],
            selectionAfter: selectionIds,
            previewStrokeId: primarySelectionId ?? selectionIds[0],
          }
        : { error: "Shift-click at least three objects before distributing them." };

    case "layout_selection": {
      if (selectionIds.length < 2) {
        return { error: "Shift-click at least two objects before laying them out." };
      }
      const layoutCommands = createLayoutCommands(
        context.boardState,
        selectionIds,
        operation.direction,
      );
      return {
        commands: layoutCommands,
        selectionAfter: selectionIds,
        previewStrokeId: primarySelectionId ?? selectionIds[0],
      };
    }

    case "undo":
    case "cancel":
      return { error: "This command is handled immediately." };
  }
}

function resolveConnectionReference(
  reference: Extract<IntentCanvasOperation, { kind: "connect" }> ["from"],
  state: BoardState,
  deictic: { thisId: string | null; thatId: string | null },
): { id: string } | { error: string } {
  if (reference.kind === "deictic") {
    const id = reference.pronoun === "this" ? deictic.thisId : deictic.thatId;
    return id
      ? { id }
      : {
          error:
            "Select the source object and Shift-click the target, or name both objects, for example “connect User to API.”",
        };
  }

  const lookup = normalizeObjectLookup(reference.normalizedLabel);
  const candidates = Object.values(state.strokes).flatMap((stroke) => {
    const annotation = stroke.annotation;
    if (
      stroke.status !== "committed" ||
      !annotation ||
      annotation.type === "connector" ||
      annotation.type === "arrow" ||
      !annotation.bounds
    ) {
      return [];
    }
    const label = normalizeObjectLookup(annotation.label ?? "");
    const nodeType = normalizeObjectLookup(annotation.nodeType ?? "");
    const exactLabel = label === lookup;
    const exactType = nodeType === lookup;
    if (!exactLabel && !exactType) {
      return [];
    }
    return [{ id: stroke.id, exactLabel }];
  });
  const exactLabelMatches = candidates.filter((candidate) => candidate.exactLabel);
  const matches = exactLabelMatches.length > 0 ? exactLabelMatches : candidates;
  if (matches.length === 0) {
    return {
      error: `I couldn’t find an object named “${reference.label}”. Use its visible label or select both endpoints.`,
    };
  }
  if (matches.length > 1) {
    return {
      error: `I found ${matches.length} objects matching “${reference.label}”. Give them unique labels or select the two endpoints.`,
    };
  }
  return { id: matches[0]!.id };
}

function normalizeObjectLookup(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the\s+/, "")
    .replace(/\s+/g, " ");
}

function resolvePlacementCenter(
  placement: Extract<IntentCanvasOperation, { kind: "create_node" }>["placement"],
  context: IntentResolutionContext,
): AnnotationPoint | null {
  if (placement.direction === "here") {
    return context.pointer;
  }
  if (placement.relativeTo.kind === "canvas") {
    return {
      x: placement.direction === "left" ? context.canvasWidth * 0.25 : context.canvasWidth * 0.75,
      y: context.canvasHeight * 0.5,
    };
  }

  const deictic = resolveDeicticIds({
    boardState: context.boardState,
    selectionIds: context.selectionIds,
    primarySelectionId: context.primarySelectionId,
    hoverStrokeId: context.hoverStrokeId,
  });
  let referenceId: string | null = null;
  switch (placement.relativeTo.kind) {
    case "selection":
      referenceId = context.primarySelectionId;
      break;
    case "focus":
      referenceId = context.hoverStrokeId ?? context.primarySelectionId;
      break;
    case "deictic":
      referenceId = placement.relativeTo.pronoun === "this" ? deictic.thisId : deictic.thatId;
      break;
    case "pointer":
      return context.pointer;
  }
  const bounds = referenceId ? context.boardState.strokes[referenceId]?.annotation?.bounds : undefined;
  if (!bounds) {
    return placement.relativeTo.kind === "focus" ? context.pointer : null;
  }
  const center = {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
  const horizontalGap = bounds.width / 2 + 126;
  const verticalGap = bounds.height / 2 + 92;
  switch (placement.direction) {
    case "left":
      return { x: center.x - horizontalGap, y: center.y };
    case "right":
      return { x: center.x + horizontalGap, y: center.y };
    case "above":
      return { x: center.x, y: center.y - verticalGap };
    case "below":
      return { x: center.x, y: center.y + verticalGap };
  }
}

function resolveDeicticIds(input: {
  boardState: BoardState;
  selectionIds: string[];
  primarySelectionId: string | null;
  hoverStrokeId: string | null;
}): { thisId: string | null; thatId: string | null } {
  const isNode = (strokeId: string | null): strokeId is string =>
    Boolean(strokeId && input.boardState.strokes[strokeId]?.annotation?.bounds);
  const thisId = isNode(input.primarySelectionId)
    ? input.primarySelectionId
    : input.selectionIds.find((strokeId) => isNode(strokeId)) ?? null;
  const thatId =
    isNode(input.hoverStrokeId) && input.hoverStrokeId !== thisId
      ? input.hoverStrokeId
      : input.selectionIds.find((strokeId) => isNode(strokeId) && strokeId !== thisId) ?? null;
  return { thisId, thatId };
}

function createLayoutCommands(
  state: BoardState,
  selectionIds: string[],
  direction: Extract<IntentCanvasOperation, { kind: "layout_selection" }>["direction"],
): DiagramCommand[] {
  const entries = selectionIds.flatMap((strokeId) => {
    const bounds = state.strokes[strokeId]?.annotation?.bounds;
    return bounds ? [{ strokeId, bounds }] : [];
  });
  if (entries.length === 0) {
    return [];
  }
  const minX = Math.min(...entries.map((entry) => entry.bounds.x));
  const minY = Math.min(...entries.map((entry) => entry.bounds.y));
  const maxWidth = Math.max(...entries.map((entry) => entry.bounds.width));
  const maxHeight = Math.max(...entries.map((entry) => entry.bounds.height));
  const horizontal = direction === "left_to_right" || direction === "right_to_left";
  const ordered = [...entries].sort((left, right) =>
    horizontal
      ? left.bounds.x - right.bounds.x || left.bounds.y - right.bounds.y
      : left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x,
  );
  if (direction === "right_to_left" || direction === "bottom_to_top") {
    ordered.reverse();
  }
  const columns = direction === "grid" ? Math.ceil(Math.sqrt(ordered.length)) : ordered.length;
  return ordered.map((entry, index) => {
    const column = direction === "grid" ? index % columns : horizontal ? index : 0;
    const row = direction === "grid" ? Math.floor(index / columns) : horizontal ? 0 : index;
    return {
      type: "objects.move",
      objectIds: [entry.strokeId],
      to: {
        x: minX + column * (maxWidth + 48),
        y: minY + row * (maxHeight + 44),
      },
    };
  });
}

function defaultNodeLabel(nodeType: NonNullable<StrokeAnnotation["nodeType"]>): string {
  return (
    AIRBOARD_SEMANTIC_NODE_CAPABILITIES.find(
      (capability) => capability.nodeType === nodeType,
    )?.defaultLabel ?? "Component"
  );
}

function clampNumber(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function buildSemanticIntentContext(
  boardState: BoardState,
  selectedStrokeIds: readonly string[],
  pointerAvailable: boolean,
): SemanticIntentContext {
  const selectedIds = new Set(selectedStrokeIds);
  const nodeStrokes = Object.values(boardState.strokes)
    .filter((stroke) => {
      const annotation = stroke.annotation;
      return Boolean(
        stroke.status === "committed" &&
          annotation?.bounds &&
          annotation.type !== "connector" &&
          annotation.type !== "arrow",
      );
    })
    .sort((left, right) => {
      const leftBounds = left.annotation!.bounds!;
      const rightBounds = right.annotation!.bounds!;
      const leftY = leftBounds.y + leftBounds.height / 2;
      const rightY = rightBounds.y + rightBounds.height / 2;
      const leftX = leftBounds.x + leftBounds.width / 2;
      const rightX = rightBounds.x + rightBounds.width / 2;
      return leftY - rightY || leftX - rightX || left.id.localeCompare(right.id);
    })
    .slice(0, 80);
  const ordinalsByType = new Map<string, number>();
  const summariesById = new Map<string, SemanticIntentContext["objects"][number]>();

  for (const stroke of nodeStrokes) {
    const annotation = stroke.annotation;
    const bounds = annotation?.bounds;
    if (!annotation || !bounds) {
      continue;
    }
    const nodeType = annotation.nodeType?.trim() || annotation.type;
    const ordinal = (ordinalsByType.get(nodeType) ?? 0) + 1;
    ordinalsByType.set(nodeType, ordinal);
    const label = annotation.label?.trim() || `${nodeType} ${ordinal}`;
    const summary = {
      label: label.slice(0, 120),
      nodeType: nodeType.slice(0, 40),
      ordinal,
      selected: selectedIds.has(stroke.id),
      position: {
        x: Math.round(bounds.x + bounds.width / 2),
        y: Math.round(bounds.y + bounds.height / 2),
      },
      size: {
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      },
    };
    summariesById.set(stroke.id, summary);
  }

  const objects = [...summariesById.values()];
  const selected = objects.filter((summary) => summary.selected).slice(0, 20);
  const edges: SemanticIntentContext["edges"] = [];
  for (const stroke of Object.values(boardState.strokes)) {
    const annotation = stroke.annotation;
    if (
      stroke.status !== "committed" ||
      !annotation ||
      (annotation.type !== "connector" && annotation.type !== "arrow") ||
      !annotation.snappedStartStrokeId ||
      !annotation.snappedEndStrokeId ||
      edges.length >= 120
    ) {
      continue;
    }
    const from = summariesById.get(annotation.snappedStartStrokeId);
    const to = summariesById.get(annotation.snappedEndStrokeId);
    if (!from || !to) {
      continue;
    }
    edges.push({
      from: { label: from.label, nodeType: from.nodeType, ordinal: from.ordinal },
      to: { label: to.label, nodeType: to.nodeType, ordinal: to.ordinal },
      ...(annotation.label?.trim() ? { label: annotation.label.trim().slice(0, 80) } : {}),
    });
  }

  return {
    selectionCount: selected.length,
    selected,
    objects,
    edges,
    projectGlossary: buildCurrentBoardGlossary(objects),
    pointerAvailable,
  };
}

const MAX_PROJECT_GLOSSARY_ENTRIES = 60;

function buildCurrentBoardGlossary(
  objects: SemanticIntentContext["objects"],
): SemanticIntentContext["projectGlossary"] {
  const entries: SemanticIntentContext["projectGlossary"] = [];
  const seen = new Set<string>();
  for (const { label } of objects) {
    const term = label.normalize("NFKC").replace(/\s+/gu, " ").trim().slice(0, 80);
    if (!term) {
      continue;
    }
    const key = term.toLocaleLowerCase("en-US");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    // Instance labels are project vocabulary, not type aliases. Their actual
    // types remain available in context.objects without poisoning the glossary.
    entries.push({ term });
    if (entries.length >= MAX_PROJECT_GLOSSARY_ENTRIES) {
      break;
    }
  }
  return entries;
}
