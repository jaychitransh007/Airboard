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
  AIRBOARD_SEMANTIC_PLAN_MAX_DIAGRAM_COMMANDS,
  canonicalShapeKind,
  connectorEndpointMatchesBinding,
  inferSemanticNodeForLabel,
  connectorGeometryMatchesBindings,
  isSceneNodeElement,
  isSceneOnlyElement,
  MIXED_GROUP_MESSAGE,
  nodeVisualDefaultSize,
  pointOnNodeBoundary,
  richTextToPlainText,
  sceneConnectorsBetween,
  sceneElementNodeType,
  shapeKindForNodeType,
  type AnnotationNodeType,
  type AnnotationPoint,
  type BoardState,
  type DiagramCommand,
  type SemanticConnectionReference,
  type SemanticObjectReference,
  type SemanticPlacement,
  type SemanticLayoutDirection,
  type SemanticPlanAction,
  type StrokeAnnotation,
} from "@airboard/core";
import { findAnnotationObjectAtPoint } from "@airboard/drawing-engine";
import { normalizeSpokenNumberAliases } from "./desiredGraphCorrection.ts";
import type { IntentCanvasOperation } from "./intentCanvasParser.ts";
import type { SemanticIntentContext } from "./semanticIntent.ts";
import { computeSemanticAutoLayout } from "./semanticAutoLayout.ts";
import {
  sceneNodeAtPoint,
  semanticBoardNodes,
  semanticObjectBounds,
  type SemanticBoardNode,
} from "./semanticBoardObjects.ts";

/**
 * Cursor-presence events replace the BoardState object dozens of times per
 * second while a hand or pointer is moving, so object identity is useless as
 * a staleness signal — it would reject every semantic plan while the camera
 * is live. Grounding only cares about committed diagram content: the reducer
 * replaces `strokes` (legacy annotations) and `elements` (v2 objects, which is
 * all Airo and the typed grammar make now) on every change to either, and
 * preserves both for cursor, presence and in-flight ink events.
 */
export function boardContentChanged(a: BoardState, b: BoardState): boolean {
  return a.strokes !== b.strokes || a.elements !== b.elements || a.clearedAt !== b.clearedAt;
}

/**
 * Existing-line commands cannot safely fall through to a planner after pure
 * grounding fails: the semantic contract has no reference to a loose line,
 * and a destructive fallback could choose a different parallel connector.
 */
export function allowsSemanticFallbackAfterGroundingFailure(
  operation: IntentCanvasOperation,
): boolean {
  return (
    operation.kind !== "attach_connection" &&
    operation.kind !== "delete_connection"
  );
}

export type IntentResolutionContext = {
  /**
   * Board coordinates of the visible window's top-left. canvasWidth/Height
   * describe the visible window (screen ÷ viewport scale), so canvas-relative
   * placements ("on the left", region centers) land inside what the user can
   * actually see, not at the board origin. Defaults to (0,0) — the identity
   * viewport.
   */
  viewOrigin?: { x: number; y: number };
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
      /** Supported request whose desired state already exists; no event needed. */
      alreadySatisfied?: boolean;
    }
  | { error: string };

export type SemanticIntentResolutionContext = IntentResolutionContext & {
  pointerAvailable: boolean;
  /**
   * Whole-plan, topology-aware centers for auto-created handles. Production
   * and eval coordinators compute this once before grounding so incidental
   * hand position and per-node viewport clamping cannot collapse a graph.
   */
  autoCreateCenters?: ReadonlyMap<string, AnnotationPoint>;
  /**
   * The selection when the person spoke, before a rebase dropped what has
   * since gone from the board. When it held anything, "this" never falls
   * back to the newest shape: the step is skipped instead. Defaults to
   * selectionIds.
   */
  requestSelectionIds?: readonly string[];
};

/**
 * How grounding filled a gap instead of refusing. Airo applies its best guess
 * and undo is the safety net, so these are reported, never asked about.
 * - data_dataset_alias: "historical data" matched "Historical Dataset".
 * - created_missing_object: a named shape wasn't on the board, so it was added.
 * - best_guess_reference: a name fitted several objects, or only part of one.
 */
export type SemanticGroundingRepairKind =
  | "data_dataset_alias"
  | "created_missing_object"
  | "best_guess_reference";

export type SemanticGroundingErrorCode =
  | "grounding_missing_label"
  | "grounding_ambiguous_label"
  | "grounding_invalid_occurrence";

type SemanticActionResolution =
  | {
      commands: DiagramCommand[];
      selectionAfter?: string[];
      handleAssignments?: Record<string, string[]>;
      repairKinds?: SemanticGroundingRepairKind[];
    }
  | {
      error: string;
      errorCode?: SemanticGroundingErrorCode;
      candidateCount?: number;
    };

type ReferenceResolution =
  | { ids: string[]; repairKind?: SemanticGroundingRepairKind }
  | { error: string; errorCode?: SemanticGroundingErrorCode; candidateCount?: number };
type SingleReferenceResolution =
  | { id: string; repairKind?: SemanticGroundingRepairKind }
  | { error: string; errorCode?: SemanticGroundingErrorCode; candidateCount?: number };

export function resolveSemanticPlanAction(
  action: SemanticPlanAction,
  context: SemanticIntentResolutionContext,
  planHandles: ReadonlyMap<string, string[]>,
): SemanticActionResolution {
  // Guesses made while matching names are reported with the step, so the
  // app can say what it picked ("Deleted Auth Service").
  const guessed = new Set<SemanticGroundingRepairKind>();
  const resolution = resolveSemanticPlanActionSteps(action, context, planHandles, guessed);
  if ("error" in resolution || guessed.size === 0) return resolution;
  return { ...resolution, repairKinds: [...new Set([...(resolution.repairKinds ?? []), ...guessed])] };
}

function resolveSemanticPlanActionSteps(
  action: SemanticPlanAction,
  context: SemanticIntentResolutionContext,
  planHandles: ReadonlyMap<string, string[]>,
  guessed: Set<SemanticGroundingRepairKind>,
): SemanticActionResolution {
  const resolveOne = (reference: SemanticObjectReference) => {
    const resolved = resolveSingleSemanticReference(reference, context, planHandles);
    if (!("error" in resolved) && resolved.repairKind) guessed.add(resolved.repairKind);
    return resolved;
  };
  const resolveMany = (references: SemanticObjectReference[]) => {
    const resolved = resolveSemanticTargets(references, context, planHandles);
    if (!("error" in resolved) && resolved.repairKind) guessed.add(resolved.repairKind);
    return resolved;
  };

  switch (action.type) {
    case "create": {
      const requested = resolveSemanticCreateCenter(
        action.placement,
        action.nodeType,
        context,
        planHandles,
        context.autoCreateCenters?.get(action.handle),
      );
      // A placement that can't be met (no live pointer, an anchor that isn't
      // there) still gets the shape drawn, in the next free spot in view.
      const center = "error" in requested
        ? resolveSemanticCreateCenter({ kind: "auto" }, action.nodeType, context, planHandles)
        : requested;
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
            ...(action.shape ? { shapeKind: action.shape } : {}),
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
      const endpoints = resolveConnectEndpointsCreatingMissing(
        action.from,
        action.to,
        context,
        planHandles,
      );
      if ("error" in endpoints) return endpoints;
      if (endpoints.created.length > 0) {
        // The new shapes aren't on the board yet, so there is nothing to
        // reuse: create them and draw the arrow in one step.
        const connect = semanticConnectCommand(endpoints.fromId, endpoints.toId, action.label, context.strokeColor);
        return {
          commands: [...endpoints.created, connect],
          selectionAfter: [endpoints.fromId, endpoints.toId],
          repairKinds: endpoints.repairKinds,
        };
      }
      const from = { id: endpoints.fromId };
      const to = { id: endpoints.toId };
      const repairKinds = endpoints.repairKinds;
      const existing = findDirectedSemanticConnections(
        context.boardState,
        from.id,
        to.id,
        { includeStale: true },
      );
      const matchingExisting = action.label === null
        ? existing
        : existing.filter(
            (connection) =>
              normalizeObjectLookup(connection.label ?? "") ===
              normalizeObjectLookup(action.label ?? ""),
          );
      if (matchingExisting.some((connection) => connection.geometryAttached)) {
        return {
          commands: [],
          selectionAfter: [from.id, to.id],
          ...(repairKinds.length > 0 ? { repairKinds } : {}),
        };
      }
      // A v2 shape can only take a v2 connector (which is all nodes.connect draws).
      if (isSceneOnlyElement(context.boardState, from.id) || isSceneOnlyElement(context.boardState, to.id)) {
        const relabel = action.label !== null && existing.length === 1 ? existing[0]! : null;
        return {
          commands: [
            relabel
              ? relabel.scene
                ? { type: "scene.rename", elementId: relabel.id, label: action.label! }
                : { type: "object.rename", objectId: relabel.id, label: action.label! }
              : semanticConnectCommand(from.id, to.id, action.label, context.strokeColor),
          ],
          selectionAfter: [from.id, to.id],
          ...(repairKinds.length > 0 ? { repairKinds } : {}),
        };
      }
      if (matchingExisting.length === 1) {
        return {
          commands: [
            {
              type: "connection.attach",
              connectorId: matchingExisting[0]!.id,
              fromId: from.id,
              toId: to.id,
              ...(action.label !== null ? { label: action.label } : {}),
            },
          ],
          selectionAfter: [from.id, to.id],
          ...(repairKinds.length > 0 ? { repairKinds } : {}),
        };
      }
      if (matchingExisting.length > 1) {
        return {
          error:
            "More than one visually detached connector matches those endpoints. Select the intended line and try again.",
        };
      }
      if (action.label !== null && existing.length === 1) {
        return {
          commands: [
            existing[0]!.geometryAttached
              ? {
                  type: "object.rename",
                  objectId: existing[0]!.id,
                  label: action.label,
                }
              : {
                  type: "connection.attach",
                  connectorId: existing[0]!.id,
                  fromId: from.id,
                  toId: to.id,
                  label: action.label,
                },
          ],
          selectionAfter: [from.id, to.id],
          ...(repairKinds.length > 0 ? { repairKinds } : {}),
        };
      }
      return {
        commands: [semanticConnectCommand(from.id, to.id, action.label, context.strokeColor)],
        selectionAfter: [from.id, to.id],
        ...(repairKinds.length > 0 ? { repairKinds } : {}),
      };
    }
    case "reverse_connection": {
      const endpoints = resolveSemanticConnectionEndpoints(
        action.connection,
        context,
        planHandles,
      );
      if ("error" in endpoints) return endpoints;
      const sourceConnections = selectSemanticConnections(
        findDirectedSemanticConnections(
          context.boardState,
          endpoints.fromId,
          endpoints.toId,
        ),
        action.connection,
      );
      if ("error" in sourceConnections) return sourceConnections;

      const desiredConnections = findDirectedSemanticConnections(
        context.boardState,
        endpoints.toId,
        endpoints.fromId,
      );
      const desiredAlreadyExists =
        action.label === null
          ? desiredConnections.length > 0
          : desiredConnections.some(
              (connection) =>
                normalizeObjectLookup(connection.label ?? "") ===
                normalizeObjectLookup(action.label ?? ""),
            );

      if (sourceConnections.connections.length === 0) {
        return desiredAlreadyExists
          ? {
              commands: [],
              selectionAfter: [endpoints.toId, endpoints.fromId],
            }
          : {
              error: "The connector to reverse does not exist in the stated direction.",
            };
      }
      const source = sourceConnections.connections[0]!;
      if (source.scene) {
        return {
          commands: [
            desiredAlreadyExists
              ? { type: "scene.delete", elementIds: [source.id] }
              : {
                  type: "scene.connector.reverse",
                  connectorId: source.id,
                  ...(action.label !== null ? { label: action.label } : {}),
                },
          ],
          selectionAfter: [endpoints.toId, endpoints.fromId],
        };
      }
      if (desiredAlreadyExists) {
        return {
          commands: [
            {
              type: "objects.delete",
              objectIds: [source.id],
              cascadeConnectors: false,
            },
          ],
          selectionAfter: [endpoints.toId, endpoints.fromId],
        };
      }
      return {
        commands: [
          {
            type: "connection.reverse",
            connectorId: source.id,
            ...(action.label !== null ? { label: action.label } : {}),
          },
        ],
        selectionAfter: [endpoints.toId, endpoints.fromId],
      };
    }
    case "delete_connection": {
      const connection = resolveSemanticConnectionReference(
        action.connection,
        context,
        planHandles,
      );
      return "error" in connection
        ? connection
        : {
            commands: [
              connection.scene
                ? { type: "scene.delete", elementIds: [connection.id] }
                : {
                    type: "objects.delete",
                    objectIds: [connection.id],
                    cascadeConnectors: false,
                  },
            ],
            selectionAfter: [],
          };
    }
    case "branch": {
      const from = resolveOne(action.from);
      if ("error" in from) return from;
      const commands: DiagramCommand[] = [];
      const targetIds: string[] = [];
      const repairKinds = new Set<SemanticGroundingRepairKind>();
      for (const [branchIndex, branch] of action.branches.entries()) {
        let to: SingleReferenceResolution = resolveOne(branch.to);
        if ("error" in to && branch.to.kind === "visible_label" && to.errorCode === "grounding_missing_label") {
          // A named outcome that isn't drawn yet is added below the decision.
          const created = createMissingNodeCommand(branch.to.label, besideCenter(
            context.boardState,
            from.id,
            "below",
            (branchIndex - (action.branches.length - 1) / 2) * 200,
          ), context);
          commands.push(created.command);
          to = { id: created.id };
          repairKinds.add("created_missing_object");
        }
        if ("error" in to) return to;
        if (to.repairKind) repairKinds.add(to.repairKind);
        if (to.id === from.id) {
          return { error: "A decision branch cannot point back to its source object." };
        }
        commands.push(semanticConnectCommand(from.id, to.id, branch.label, context.strokeColor));
        targetIds.push(to.id);
      }
      if (new Set(targetIds).size !== targetIds.length) {
        return { error: "Each decision branch must target a distinct object." };
      }
      return {
        commands,
        selectionAfter: [from.id, ...targetIds],
        ...(repairKinds.size > 0 ? { repairKinds: [...repairKinds] } : {}),
      };
    }
    case "rename": {
      const target = resolveOne(action.target);
      return "error" in target
        ? target
        : {
            commands: [
              isSceneOnlyElement(context.boardState, target.id)
                ? { type: "scene.rename", elementId: target.id, label: action.label }
                : { type: "object.rename", objectId: target.id, label: action.label },
            ],
            selectionAfter: [target.id],
          };
    }
    case "delete": {
      // "Delete this" with a connector selected deletes the connector.
      const selectedConnectors = action.targets.some((target) => target.kind === "current_selection")
        ? selectedConnectorIds(context)
        : [];
      const otherTargets = selectedConnectors.length > 0
        ? action.targets.filter((target) => target.kind !== "current_selection")
        : action.targets;
      const selectedNodes = selectedConnectors.length > 0 ? selectedNodeIds(context) : [];
      const resolvedOthers = otherTargets.length > 0 ? resolveMany(otherTargets) : { ids: [] as string[] };
      if ("error" in resolvedOthers) return resolvedOthers;
      const targets = { ids: [...new Set([...selectedNodes, ...selectedConnectors, ...resolvedOthers.ids])] };
      const { legacy, scene } = splitByWorld(context.boardState, targets.ids);
      return {
        commands: [
          ...(legacy.length > 0 ? [{ type: "objects.delete", objectIds: legacy } as const] : []),
          ...(scene.length > 0 ? [{ type: "scene.delete", elementIds: scene } as const] : []),
        ],
        selectionAfter: [],
      };
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
      const { legacy, scene } = splitByWorld(context.boardState, targets.ids);
      if (scene.length === 0) {
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
      // Each kind is copied by its own command. The copies don't exist while
      // planning, so the placement's move becomes part of the copy offset.
      const offset = duplicateOffsetWithPlacement(context.boardState, targets.ids, placement);
      const copiesOf = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, idMap[id]!]));
      return {
        commands: [
          ...(legacy.length > 0
            ? [{ type: "objects.duplicate", objectIds: legacy, idMap: copiesOf(legacy), offset } as const]
            : []),
          { type: "scene.duplicate", elementIds: scene, idMap: copiesOf(scene), offset },
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
      return {
        commands: placement.commands.flatMap((command) => splitMoveByWorld(context.boardState, command)),
        selectionAfter: targets.ids,
      };
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
        commands:
          action.direction === "tree"
            ? createTreeLayoutCommands(context.boardState, targets.ids)
            : action.direction === "radial"
              ? createRadialLayoutCommands(context.boardState, targets.ids)
              : createLayoutCommands(context.boardState, targets.ids, action.direction),
        selectionAfter: targets.ids,
      };
    }
    case "group": {
      const targets = resolveMany(action.targets);
      if ("error" in targets) return targets;
      const groupId = crypto.randomUUID();
      const { legacy, scene } = splitByWorld(context.boardState, targets.ids);
      if (scene.length > 0) {
        // Only shapes on a board saved before Airo drew v2 shapes are
        // legacy; every shape made since, Airo's included, groups together.
        if (legacy.length > 0) {
          return { error: MIXED_GROUP_MESSAGE };
        }
        // A section, as the toolbar makes. Sections aren't objects Airo names,
        // so the shapes stay selected rather than the section.
        return {
          commands: [{ type: "scene.group", sectionId: groupId, memberIds: scene, ...(action.label ? { label: action.label } : {}) }],
          selectionAfter: scene,
          handleAssignments: { [action.handle]: [groupId] },
        };
      }
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
        (id) => context.boardState.strokes[id]?.status === "committed" || isSceneOnlyElement(context.boardState, id),
      );
      const next =
        action.mode === "replace"
          ? targets.ids
          : action.mode === "add"
            ? [...new Set([...current, ...targets.ids])]
            : current.filter((id) => !targets.ids.includes(id));
      return { commands: [], selectionAfter: next };
    }
    case "change_type": {
      const targets = resolveMany(action.targets);
      if ("error" in targets) return targets;
      const commands = targets.ids.flatMap((id): DiagramCommand[] => {
        if (!isSceneOnlyElement(context.boardState, id)) {
          return [{ type: "object.retype", objectId: id, nodeType: action.nodeType, shapeKind: action.shape }];
        }
        // Only v2 shapes have a shape to change; a sticky or text stays as it is.
        return context.boardState.elements[id]?.kind === "shape"
          ? [{
              type: "scene.retype",
              elementId: id,
              shapeKind: action.shape ?? shapeKindForNodeType(action.nodeType),
              nodeType: action.nodeType,
            }]
          : [];
      });
      return commands.length > 0
        ? { commands, selectionAfter: targets.ids }
        : { error: "Only shapes can change type." };
    }
    case "resize": {
      const targets = resolveMany(action.targets);
      if ("error" in targets) return targets;
      const direction = action.change === "bigger" ? "grow" : "shrink";
      const commands = targets.ids.flatMap((id): DiagramCommand[] => {
        const bounds = semanticObjectBounds(context.boardState, id);
        if (!bounds) return [];
        const resized = resizeBoundsAroundCenter(bounds, "both", direction);
        return isSceneOnlyElement(context.boardState, id)
          ? [{ type: "scene.resize", elementId: id, bounds: resized }]
          : [{ type: "object.resize", objectId: id, bounds: resized }];
      });
      return commands.length > 0
        ? { commands, selectionAfter: targets.ids }
        : { error: "Those objects can't be resized." };
    }
    case "label_connection": {
      // "The arrow between Database and API" may point either way.
      const connection = resolveSemanticConnectionReference(action.connection, context, planHandles, {
        eitherDirection: true,
      });
      if ("error" in connection) {
        // "Label the arrow from User to API as login" with no arrow there
        // either way: the person wants a labelled arrow, so draw one.
        return connection.missingConnector
          ? resolveSemanticPlanAction(
              { type: "connect", from: action.connection.from, to: action.connection.to, label: action.label },
              context,
              planHandles,
            )
          : connection;
      }
      return {
        commands: [
          connection.scene
            ? { type: "scene.rename", elementId: connection.id, label: action.label }
            : { type: "object.rename", objectId: connection.id, label: action.label },
        ],
        selectionAfter: [connection.fromId, connection.toId],
      };
    }
    case "style_connection": {
      const connection = resolveSemanticConnectionReference(action.connection, context, planHandles);
      if ("error" in connection) return connection;
      return {
        commands: [
          connection.scene
            ? { type: "scene.connector.restyle", connectorId: connection.id, lineStyle: action.lineStyle }
            : { type: "connector.restyle", connectorId: connection.id, lineStyle: action.lineStyle },
        ],
        selectionAfter: [connection.fromId, connection.toId],
      };
    }
    case "undo":
    case "cancel":
      return { error: "Undo and cancel are handled immediately." };
  }
}

/**
 * Grounds both ends of a connect step. A name that matches nothing on the
 * board is a shape the person expects to exist ("connect the user to the
 * cache" with no cache yet), so it is created beside the other end instead
 * of refusing the whole request.
 */
function resolveConnectEndpointsCreatingMissing(
  fromReference: SemanticObjectReference,
  toReference: SemanticObjectReference,
  context: SemanticIntentResolutionContext,
  planHandles: ReadonlyMap<string, string[]>,
):
  | {
      fromId: string;
      toId: string;
      created: DiagramCommand[];
      repairKinds: SemanticGroundingRepairKind[];
    }
  | Extract<SemanticActionResolution, { error: string }> {
  const from = resolveSingleSemanticConnectReference(fromReference, context, planHandles);
  const to = resolveSingleSemanticConnectReference(toReference, context, planHandles);
  const missing = (reference: SemanticObjectReference, resolved: SingleReferenceResolution) =>
    "error" in resolved && reference.kind === "visible_label" && resolved.errorCode === "grounding_missing_label";
  const created: DiagramCommand[] = [];
  const repairKinds = new Set<SemanticGroundingRepairKind>();
  let fromId: string;
  let toId: string;
  if ("error" in from) {
    if (!missing(fromReference, from)) return from;
    if ("error" in to && !missing(toReference, to)) return to;
    const center = "error" in to
      ? autoCreateCenter(context, planHandles)
      : besideCenter(context.boardState, to.id, "left");
    const node = createMissingNodeCommand((fromReference as { label: string }).label, center, context);
    created.push(node.command);
    fromId = node.id;
  } else {
    fromId = from.id;
    if (from.repairKind) repairKinds.add(from.repairKind);
  }
  if ("error" in to) {
    if (!missing(toReference, to)) return to;
    const fromCenter = "error" in from
      ? (created[0] as Extract<DiagramCommand, { type: "node.create" }>).center!
      : null;
    const center = fromCenter
      ? { x: fromCenter.x + 270, y: fromCenter.y }
      : besideCenter(context.boardState, fromId, "right");
    const node = createMissingNodeCommand((toReference as { label: string }).label, center, context);
    created.push(node.command);
    toId = node.id;
  } else {
    toId = to.id;
    if (to.repairKind) repairKinds.add(to.repairKind);
  }
  if (fromId === toId) {
    return { error: "The source and target resolve to the same object." };
  }
  if (created.length > 0) repairKinds.add("created_missing_object");
  return {
    fromId,
    toId,
    created,
    repairKinds: [...repairKinds],
  };
}

/** A node.create for a spoken name, typed and shaped from the name ("Orders Cache" → cache shape). */
function createMissingNodeCommand(
  label: string,
  center: AnnotationPoint,
  context: SemanticIntentResolutionContext,
): { id: string; command: DiagramCommand } {
  const id = crypto.randomUUID();
  const inferred = inferSemanticNodeForLabel(label);
  return {
    id,
    command: {
      type: "node.create",
      nodeId: id,
      nodeType: inferred.nodeType,
      ...(inferred.shape ? { shapeKind: inferred.shape } : {}),
      label: titleCase(label.trim()),
      center,
      source: "voice",
      style: { strokeColor: context.strokeColor },
    },
  };
}

function autoCreateCenter(
  context: SemanticIntentResolutionContext,
  planHandles: ReadonlyMap<string, string[]>,
): AnnotationPoint {
  const center = resolveSemanticCreateCenter({ kind: "auto" }, "custom", context, planHandles);
  return "error" in center
    ? { x: (context.viewOrigin?.x ?? 0) + context.canvasWidth / 2, y: (context.viewOrigin?.y ?? 0) + context.canvasHeight / 2 }
    : center.point;
}

/** A free-standing spot beside an object, for a shape created to join it. */
function besideCenter(
  state: BoardState,
  anchorId: string,
  direction: "left" | "right" | "below",
  sideways = 0,
): AnnotationPoint {
  const bounds = semanticObjectBounds(state, anchorId) ?? { x: 0, y: 0, width: 0, height: 0 };
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  if (direction === "below") return { x: center.x + sideways, y: center.y + bounds.height / 2 + 140 };
  const offset = bounds.width / 2 + 200;
  return { x: center.x + (direction === "left" ? -offset : offset), y: center.y };
}

/** A new arrow, drawn as a v2 connector whichever kind of object each end is. */
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

/** The copies' offset, with any move the placement asked for folded in. */
function duplicateOffsetWithPlacement(
  state: BoardState,
  sourceIds: string[],
  placement: { commands: DiagramCommand[]; duplicateOffset: AnnotationPoint },
): AnnotationPoint {
  const bounds = semanticSelectionBounds(state, sourceIds);
  return placement.commands.reduce((offset, command) => {
    if (command.type !== "objects.move") return offset;
    const delta = command.delta ?? (command.to && bounds
      ? { x: command.to.x - bounds.x, y: command.to.y - bounds.y }
      : { x: 0, y: 0 });
    return { x: offset.x + delta.x, y: offset.y + delta.y };
  }, placement.duplicateOffset);
}

/** Legacy nodes take stroke commands; v2 shapes take scene commands. */
function splitByWorld(state: BoardState, ids: readonly string[]): { legacy: string[]; scene: string[] } {
  const scene = ids.filter((id) => isSceneOnlyElement(state, id));
  return { legacy: ids.filter((id) => !scene.includes(id)), scene };
}

/** A move of mixed objects: the same shift for each kind, through its own command. */
function splitMoveByWorld(state: BoardState, command: DiagramCommand): DiagramCommand[] {
  if (command.type !== "objects.move") return [command];
  const { legacy, scene } = splitByWorld(state, command.objectIds);
  if (scene.length === 0) return [command];
  const bounds = semanticSelectionBounds(state, command.objectIds);
  const delta = command.delta ?? (command.to && bounds
    ? { x: command.to.x - bounds.x, y: command.to.y - bounds.y }
    : { x: 0, y: 0 });
  return [
    ...(legacy.length > 0 ? [{ type: "objects.move", objectIds: legacy, delta } as const] : []),
    { type: "scene.move", elementIds: scene, delta },
  ];
}

type DirectedSemanticConnection = {
  id: string;
  label: string | null;
  geometryAttached: boolean;
  /** When it was drawn, for picking the newest of several parallel lines. */
  createdAtMs: number;
  /** A v2 connector, changed through scene commands. */
  scene?: boolean;
};

function findDirectedSemanticConnections(
  state: BoardState,
  fromId: string,
  toId: string,
  options: { includeStale?: boolean } = {},
): DirectedSemanticConnection[] {
  return Object.values(state.strokes)
    .flatMap((stroke): DirectedSemanticConnection[] => {
      const annotation = stroke.annotation;
      if (
        stroke.status !== "committed" ||
        !annotation ||
        (annotation.type !== "connector" && annotation.type !== "arrow") ||
        annotation.snappedStartStrokeId !== fromId ||
        annotation.snappedEndStrokeId !== toId
      ) {
        return [];
      }
      const geometryAttached = connectorGeometryMatchesBindings(
        state,
        annotation,
        fromId,
        toId,
      );
      if (!geometryAttached && !options.includeStale) {
        return [];
      }
      return [{
        id: stroke.id,
        label: annotation.label?.trim() || null,
        geometryAttached,
        createdAtMs: nodeCreatedAtMs(state, stroke.id),
      }];
    })
    .concat(sceneConnectorsBetween(state, fromId, toId).map((connector) => ({
      id: connector.id,
      label: richTextToPlainText(connector.label).trim() || null,
      geometryAttached: true,
      createdAtMs: nodeCreatedAtMs(state, connector.id),
      scene: true,
    })))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function resolveSemanticConnectionEndpoints(
  reference: SemanticConnectionReference,
  context: SemanticIntentResolutionContext,
  planHandles: ReadonlyMap<string, string[]>,
): { fromId: string; toId: string } | { error: string; errorCode?: SemanticGroundingErrorCode } {
  const from = resolveSingleSemanticReference(reference.from, context, planHandles);
  if ("error" in from) return from;
  const to = resolveSingleSemanticReference(reference.to, context, planHandles);
  if ("error" in to) return to;
  if (from.id === to.id) {
    return { error: "A connector reference requires two different endpoints." };
  }
  return { fromId: from.id, toId: to.id };
}

/**
 * Narrows the connectors between two objects to the one meant. With several
 * equally good matches and no occurrence, the newest is the best guess: it is
 * usually the one just drawn and talked about. Undo puts back a wrong pick.
 */
function selectSemanticConnections(
  connections: DirectedSemanticConnection[],
  reference: SemanticConnectionReference,
):
  | { connections: DirectedSemanticConnection[] }
  | { error: string } {
  const matching = reference.label ? connectionsMatchingLabel(connections, reference.label) : connections;
  if (reference.occurrence !== null) {
    const connection = matching[reference.occurrence - 1];
    return connection
      ? { connections: [connection] }
      : {
          error: `There is no matching connector occurrence ${reference.occurrence}.`,
        };
  }
  if (matching.length > 1) {
    const newest = matching.reduce((best, connection) =>
      connection.createdAtMs > best.createdAtMs ? connection : best);
    return { connections: [newest] };
  }
  return { connections: matching };
}

/**
 * The connectors a spoken label means. An exact match wins; otherwise a near
 * match (a slip of one or two letters, "log in" for "login", or one label's
 * words all inside the other's) is taken as misheard. With no near match, the
 * only connector between the endpoints is meant when it has no label at all.
 * A connector with a clearly different label is never picked: "delete the
 * login arrow" must not delete the "logout" one.
 */
function connectionsMatchingLabel(
  connections: DirectedSemanticConnection[],
  spoken: string,
): DirectedSemanticConnection[] {
  const lookup = normalizeObjectLookup(spoken);
  const exact = connections.filter((connection) => normalizeObjectLookup(connection.label ?? "") === lookup);
  if (exact.length > 0) return exact;
  const near = connections.filter((connection) => connection.label !== null && connectorLabelsNearMatch(spoken, connection.label));
  if (near.length > 0) return near;
  return connections.length === 1 && connections[0]!.label === null ? connections : [];
}

export function connectorLabelsNearMatch(spoken: string, visible: string): boolean {
  const left = normalizeObjectLookup(spoken);
  const right = normalizeObjectLookup(visible);
  if (!left || !right) return false;
  const leftCompact = left.replace(/\s+/gu, "");
  const rightCompact = right.replace(/\s+/gu, "");
  if (leftCompact === rightCompact) return true;
  const longest = Math.max(leftCompact.length, rightCompact.length);
  // Short labels ("yes", "no", "ok") need an exact match: one letter is a different word.
  if (longest >= 5 && editDistance(leftCompact, rightCompact) <= Math.floor(longest / 5)) return true;
  const leftWords = labelWords(left);
  const rightWords = labelWords(right);
  const [shorter, longer] = leftWords.length <= rightWords.length ? [leftWords, rightWords] : [rightWords, leftWords];
  if (shorter.length === 0) return false;
  const longerSet = new Set(longer);
  return shorter.every((word) => longerSet.has(word));
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length]!;
}

function resolveSemanticConnectionReference(
  reference: SemanticConnectionReference,
  context: SemanticIntentResolutionContext,
  planHandles: ReadonlyMap<string, string[]>,
  options: { eitherDirection?: boolean } = {},
):
  | { id: string; fromId: string; toId: string; scene?: boolean }
  | { error: string; errorCode?: SemanticGroundingErrorCode; missingConnector?: true } {
  const endpoints = resolveSemanticConnectionEndpoints(reference, context, planHandles);
  if ("error" in endpoints) return endpoints;
  const forward = findDirectedSemanticConnections(context.boardState, endpoints.fromId, endpoints.toId);
  const selected = selectSemanticConnections(forward, reference);
  if ("error" in selected) return selected;
  const connection = selected.connections[0];
  if (connection) {
    return { id: connection.id, ...endpoints, ...(connection.scene ? { scene: true } : {}) };
  }
  let anyBetween = forward.length > 0;
  if (options.eitherDirection) {
    const backward = findDirectedSemanticConnections(context.boardState, endpoints.toId, endpoints.fromId);
    anyBetween ||= backward.length > 0;
    const reversed = selectSemanticConnections(backward, reference);
    const match = "error" in reversed ? undefined : reversed.connections[0];
    if (match) {
      return {
        id: match.id,
        fromId: endpoints.toId,
        toId: endpoints.fromId,
        ...(match.scene ? { scene: true } : {}),
      };
    }
  }
  return anyBetween
    ? { error: "No connector between those objects has that label." }
    : { error: "No connector matches the stated direction, label, and occurrence.", missingConnector: true };
}

function resolveSingleSemanticReference(
  reference: SemanticObjectReference,
  context: SemanticIntentResolutionContext,
  planHandles: ReadonlyMap<string, string[]>,
): SingleReferenceResolution {
  const resolved = resolveSemanticReference(reference, context, planHandles);
  if ("error" in resolved) return resolved;
  if (resolved.ids.length !== 1) {
    return { error: `That reference resolves to ${resolved.ids.length} objects; name one object or give its ordinal.` };
  }
  return { id: resolved.ids[0]!, ...(resolved.repairKind ? { repairKind: resolved.repairKind } : {}) };
}

/**
 * Additive connections may recover the narrow STT morphology
 * data/dataset/datasets after exact and partial-name grounding fail.
 * Destructive and identity-changing actions don't use this alias.
 */
function resolveSingleSemanticConnectReference(
  reference: SemanticObjectReference,
  context: SemanticIntentResolutionContext,
  planHandles: ReadonlyMap<string, string[]>,
): SingleReferenceResolution {
  const exact = resolveSingleSemanticReference(reference, context, planHandles);
  if (!("error" in exact) || reference.kind !== "visible_label" || exact.errorCode !== "grounding_missing_label") {
    return exact;
  }
  if (reference.occurrence !== null && reference.occurrence !== 1) {
    return {
      error: `There is no occurrence ${reference.occurrence} of “${reference.label}”.`,
      errorCode: "grounding_invalid_occurrence",
    };
  }
  const matches = spatialSemanticNodes(context.boardState).filter((entry) =>
    dataDatasetEquivalentReference(reference.label, entry.label),
  );
  if (matches.length > 0) {
    return { id: bestGuessNode(matches, context).id, repairKind: "data_dataset_alias" };
  }
  return {
    error: `I couldn’t match “${reference.label}” to an object on the current board.`,
    errorCode: "grounding_missing_label",
    candidateCount: 0,
  };
}

function dataDatasetEquivalentReference(spoken: string, visible: string): boolean {
  const spokenTokens = normalizeObjectLookup(spoken).split(" ").filter(Boolean);
  const visibleTokens = normalizeObjectLookup(visible).split(" ").filter(Boolean);
  if (spokenTokens.length !== visibleTokens.length || spokenTokens.length < 2) {
    return false;
  }
  let aliasDifference = false;
  let anchored = false;
  for (let index = 0; index < spokenTokens.length; index += 1) {
    const spokenToken = spokenTokens[index]!;
    const visibleToken = visibleTokens[index]!;
    if (spokenToken === visibleToken) {
      if (!isDataDatasetToken(spokenToken)) {
        anchored = true;
      }
      continue;
    }
    if (
      isDataDatasetToken(spokenToken) &&
      isDataDatasetToken(visibleToken)
    ) {
      aliasDifference = true;
      continue;
    }
    return false;
  }
  return aliasDifference && anchored;
}

function isDataDatasetToken(value: string): boolean {
  return value === "data" || value === "dataset" || value === "datasets";
}

function resolveSemanticTargets(
  references: SemanticObjectReference[],
  context: SemanticIntentResolutionContext,
  planHandles: ReadonlyMap<string, string[]>,
): ReferenceResolution {
  const ids: string[] = [];
  let repairKind: SemanticGroundingRepairKind | undefined;
  for (const reference of references) {
    const resolved = resolveSemanticReference(reference, context, planHandles, { many: true });
    if ("error" in resolved) return resolved;
    ids.push(...resolved.ids);
    repairKind ??= resolved.repairKind;
  }
  const unique = [...new Set(ids)];
  return unique.length > 0
    ? { ids: unique, ...(repairKind ? { repairKind } : {}) }
    : { error: "No board objects matched that reference." };
}

function resolveSemanticReference(
  reference: SemanticObjectReference,
  context: SemanticIntentResolutionContext,
  planHandles: ReadonlyMap<string, string[]>,
  options: { many?: boolean } = {},
): ReferenceResolution {
  const nodes = semanticBoardNodes(context.boardState);
  const nodeIds = new Set(nodes.map(({ id }) => id));
  const isNode = (id: string | null | undefined): id is string => Boolean(id && nodeIds.has(id));
  switch (reference.kind) {
    case "current_selection": {
      const ids = context.selectionIds.filter(isNode);
      if (ids.length > 0) return { ids };
      // Something was selected, but not a shape this step can change (a
      // connector, say), or it has gone since the person spoke: never guess.
      if (context.selectionIds.length > 0 || (context.requestSelectionIds?.length ?? 0) > 0) {
        return { error: "What was selected isn't a shape Airo can change that way, or it's no longer on the board." };
      }
      // "it" or "this" with nothing selected means the shape just made.
      const newest = newestNode(nodes, context.boardState);
      return newest
        ? { ids: [newest.id], repairKind: "best_guess_reference" }
        : { error: "There is no current object selection." };
    }
    case "pointer": {
      if (isNode(context.hoverStrokeId)) return { ids: [context.hoverStrokeId] };
      if (!context.pointerAvailable) {
        return { error: "No live pointer target is available. Point at an object and try again." };
      }
      const hit = findAnnotationObjectAtPoint(context.boardState, context.pointer);
      if (isNode(hit?.id)) return { ids: [hit.id] };
      const sceneHit = sceneNodeAtPoint(context.boardState, context.pointer);
      return sceneHit
        ? { ids: [sceneHit.id] }
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
      const exact = nodes.filter((entry) => normalizeObjectLookup(entry.label) === lookup);
      const candidates = exact.length > 0 ? exact : looseLabelCandidates(nodes, reference.label);
      if (candidates.length === 0) {
        return {
          error: `I couldn’t find the visible label “${reference.label}”.`,
          errorCode: "grounding_missing_label",
          candidateCount: 0,
        };
      }
      if (reference.occurrence !== null) {
        const match = candidates[reference.occurrence - 1];
        return match
          ? { ids: [match.id], ...(exact.length > 0 ? {} : { repairKind: "best_guess_reference" as const }) }
          : {
              error: `There is no occurrence ${reference.occurrence} of “${reference.label}”.`,
              errorCode: "grounding_invalid_occurrence",
              candidateCount: candidates.length,
            };
      }
      if (candidates.length === 1 && exact.length === 1) return { ids: [candidates[0]!.id] };
      // "Delete the services" means every service, where a step takes several.
      if (options.many && exact.length === 0 && candidates.length > 1 && spokenAsPlural(reference.label, candidates)) {
        return { ids: candidates.map(({ id }) => id), repairKind: "best_guess_reference" };
      }
      return { ids: [bestGuessNode(candidates, context).id], repairKind: "best_guess_reference" };
    }
    case "type_ordinal": {
      const matches = nodes.filter(
        (entry) => entry.nodeType === reference.nodeType,
      );
      const match = matches[reference.ordinal - 1];
      return match
        ? { ids: [match.id] }
        : { error: `There is no ${reference.nodeType} number ${reference.ordinal} on the board.` };
    }
  }
}

/**
 * The name's last word is a plural that none of the matching labels spells
 * out ("services" against "Payments Service"), so it means them all. A name
 * that is itself plural on the board ("Orders" against "Orders Service")
 * still means one.
 */
function spokenAsPlural(label: string, candidates: SemanticBoardNode[]): boolean {
  const words = normalizeObjectLookup(label).split(" ").filter((word) => word && !LOOSE_LABEL_FILLER.has(word));
  const last = words[words.length - 1];
  if (!last || last.length <= 3 || !last.endsWith("s") || last.endsWith("ss")) return false;
  return candidates.every((candidate) => !normalizeObjectLookup(candidate.label).split(" ").includes(last));
}

/** Selected shapes Airo can name, as current_selection means them. */
function selectedNodeIds(context: SemanticIntentResolutionContext): string[] {
  const nodeIds = new Set(semanticBoardNodes(context.boardState).map(({ id }) => id));
  return context.selectionIds.filter((id) => nodeIds.has(id));
}

/** Selected connectors still on the board, legacy or v2. */
function selectedConnectorIds(context: SemanticIntentResolutionContext): string[] {
  const state = context.boardState;
  return context.selectionIds.filter((id) => {
    const stroke = state.strokes[id];
    if (stroke) {
      return stroke.status === "committed" &&
        (stroke.annotation?.type === "connector" || stroke.annotation?.type === "arrow");
    }
    return isSceneOnlyElement(state, id) && state.elements[id]?.kind === "connector";
  });
}

const LOOSE_LABEL_FILLER = new Set(["the", "a", "an", "one", "my", "our", "that", "this"]);

function labelWords(value: string): string[] {
  return normalizeObjectLookup(value)
    .split(" ")
    .filter((word) => word && !LOOSE_LABEL_FILLER.has(word))
    .map((word) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word));
}

/**
 * Objects a name fits without matching it exactly: every spoken word is in
 * the label ("the service" → "Payments Service"), or the name is the
 * object's type ("the database" → a database labelled Orders). Never a
 * looser guess than that, so a stray word can't pick an unrelated shape.
 */
function looseLabelCandidates(nodes: SemanticBoardNode[], label: string): SemanticBoardNode[] {
  const spoken = labelWords(label);
  if (spoken.length === 0) return [];
  const contained = nodes.filter((node) => {
    const words = new Set(labelWords(node.label));
    return spoken.every((word) => words.has(word));
  });
  if (contained.length > 0) return contained;
  const phrase = normalizeObjectLookup(label).replace(/^(?:the|a|an)\s+/u, "");
  const shapeKind = canonicalShapeKind(phrase);
  return nodes.filter((node) => {
    const capability = AIRBOARD_SEMANTIC_NODE_CAPABILITIES.find(({ nodeType }) => nodeType === node.nodeType);
    if (capability && capability.nodeType !== "custom" && (capability.terms as readonly string[]).includes(phrase)) return true;
    return node.world === "scene" && shapeKind !== null && node.nodeType === shapeKind;
  });
}

function nodeCreatedAtMs(state: BoardState, id: string): number {
  const raw = state.strokes[id]?.createdAt ?? state.elements[id]?.createdAt;
  const parsed = raw ? Date.parse(raw) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function newestNode(nodes: SemanticBoardNode[], state: BoardState): SemanticBoardNode | null {
  let newest: SemanticBoardNode | null = null;
  let newestAt = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    const at = nodeCreatedAtMs(state, node.id);
    // Ties keep the later object in reading order, the one drawn last in a flow.
    if (newest === null || at >= newestAt) {
      newest = node;
      newestAt = at;
    }
  }
  return newest;
}

/**
 * Picks one of several objects a name fits: the selected one, else the most
 * recently created, else the one nearest the pointer, else the first in
 * reading order. Airo applies this guess straight away; undo covers a miss.
 */
function bestGuessNode(
  candidates: SemanticBoardNode[],
  context: SemanticIntentResolutionContext,
): SemanticBoardNode {
  if (candidates.length === 1) return candidates[0]!;
  const primary = candidates.find(({ id }) => id === context.primarySelectionId);
  if (primary) return primary;
  const selected = candidates.find(({ id }) => context.selectionIds.includes(id));
  if (selected) return selected;
  const times = candidates.map(({ id }) => nodeCreatedAtMs(context.boardState, id));
  const newestAt = Math.max(...times);
  const newest = Number.isFinite(newestAt)
    ? candidates.filter((_, index) => times[index] === newestAt)
    : candidates;
  if (newest.length === 1) return newest[0]!;
  if (context.pointerAvailable) {
    const distance = ({ bounds }: SemanticBoardNode) =>
      Math.hypot(bounds.x + bounds.width / 2 - context.pointer.x, bounds.y + bounds.height / 2 - context.pointer.y);
    return newest.reduce((best, node) => (distance(node) < distance(best) ? node : best));
  }
  return newest[0]!;
}


type SpatialSemanticNode = SemanticBoardNode;

function spatialSemanticNodes(state: BoardState): SpatialSemanticNode[] {
  return semanticBoardNodes(state);
}

function resolveSemanticCreateCenter(
  placement: SemanticPlacement,
  nodeType: AnnotationNodeType,
  context: SemanticIntentResolutionContext,
  planHandles: ReadonlyMap<string, string[]>,
  plannedCenter?: AnnotationPoint,
): { point: AnnotationPoint } | { error: string } {
  if (placement.kind === "auto") {
    if (plannedCenter) {
      return { point: plannedCenter };
    }
    const size = nodeVisualDefaultSize(nodeType);
    const originX = context.viewOrigin?.x ?? 0;
    const originY = context.viewOrigin?.y ?? 0;
    const viewportCenter = {
      x: originX + context.canvasWidth / 2,
      y: originY + context.canvasHeight / 2,
    };
    const stepX = size.width + 96;
    const stepY = size.height + 96;
    const occupiedBounds = semanticBoardNodes(context.boardState).map(({ bounds }) => bounds);
    const offsets = semanticAutoPlacementOffsets(planHandles.size + occupiedBounds.length + 1);
    for (const offset of offsets) {
      const point = {
        x: viewportCenter.x + offset.x * stepX,
        y: viewportCenter.y + offset.y * stepY,
      };
      const bounds = {
        x: point.x - size.width / 2,
        y: point.y - size.height / 2,
        width: size.width,
        height: size.height,
      };
      if (
        bounds.x < originX + 24 ||
        bounds.y < originY + 24 ||
        bounds.x + bounds.width > originX + context.canvasWidth - 24 ||
        bounds.y + bounds.height > originY + context.canvasHeight - 24
      ) {
        continue;
      }
      if (
        occupiedBounds.every(
          (occupied) =>
            bounds.x + bounds.width + 48 <= occupied.x ||
            occupied.x + occupied.width + 48 <= bounds.x ||
            bounds.y + bounds.height + 48 <= occupied.y ||
            occupied.y + occupied.height + 48 <= bounds.y,
        )
      ) {
        return { point };
      }
    }
    return {
      point: {
        x: viewportCenter.x,
        y:
          originY +
          context.canvasHeight +
          48 +
          planHandles.size * stepY,
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
  const bounds = semanticObjectBounds(context.boardState, anchor.id);
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

function semanticAutoPlacementOffsets(minimumCount: number): AnnotationPoint[] {
  const offsets: AnnotationPoint[] = [{ x: 0, y: 0 }];
  const targetCount = Math.max(minimumCount, 25);
  for (let ring = 1; offsets.length < targetCount; ring += 1) {
    for (let y = -ring; y <= ring; y += 1) {
      for (let x = -ring; x <= ring; x += 1) {
        if (Math.max(Math.abs(x), Math.abs(y)) !== ring) continue;
        offsets.push({ x, y });
      }
    }
  }
  return offsets;
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
    const anchorBounds = semanticObjectBounds(context.boardState, anchor.id);
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
  context: Pick<SemanticIntentResolutionContext, "canvasWidth" | "canvasHeight" | "viewOrigin">,
): AnnotationPoint {
  const x = region === "left" ? 0.25 : region === "right" ? 0.75 : 0.5;
  const y = region === "top" ? 0.25 : region === "bottom" ? 0.75 : 0.5;
  return {
    x: (context.viewOrigin?.x ?? 0) + context.canvasWidth * x,
    y: (context.viewOrigin?.y ?? 0) + context.canvasHeight * y,
  };
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
    const value = semanticObjectBounds(state, id);
    return value ? [value] : [];
  });
  if (bounds.length === 0) return null;
  const minX = Math.min(...bounds.map((value) => value.x));
  const minY = Math.min(...bounds.map((value) => value.y));
  const maxX = Math.max(...bounds.map((value) => value.x + value.width));
  const maxY = Math.max(...bounds.map((value) => value.y + value.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** One plan step that was left out while the rest of the plan was applied. */
export type SkippedSemanticAction = {
  /** Position of the step in plan.actions. */
  index: number;
  actionType: SemanticPlanAction["type"];
  /** Plain-language reason, safe to show or speak. */
  reason: string;
  errorCode:
    | SemanticGroundingErrorCode
    | "grounding_failed"
    | "depends_on_skipped_step"
    | "command_limit"
    | "command_failed";
};

export type SemanticPlanGroundingInput = {
  actions: readonly SemanticPlanAction[];
  /**
   * The request-time snapshot. selectionIds and primarySelectionId are what
   * current_selection means for every step, even after earlier steps change
   * the selection. autoCreateCenters is computed here when absent.
   */
  context: SemanticIntentResolutionContext;
  /** Applies one command to the preview, usually applyDiagramCommand with the board's command context. */
  applyCommand: (
    state: BoardState,
    command: DiagramCommand,
  ) => { state: BoardState; affectedStrokeIds: readonly string[] };
  /** Defaults to AIRBOARD_SEMANTIC_PLAN_MAX_DIAGRAM_COMMANDS. */
  maxCommands?: number;
};

export type SemanticPlanGrounding =
  | {
      status: "grounded";
      /** Every command to apply, in order, as one undoable change. */
      commands: DiagramCommand[];
      /** The board after the commands, for the preview. */
      previewState: BoardState;
      affectedStrokeIds: string[];
      /** The selection the board should show afterwards. */
      selectionIds: string[];
      primarySelectionId: string | null;
      appliedActionCount: number;
      /** Steps left out; empty when the whole plan applied. */
      skipped: SkippedSemanticAction[];
      repairs: Array<{
        index: number;
        actionType: SemanticPlanAction["type"];
        repairKinds: SemanticGroundingRepairKind[];
      }>;
    }
  | {
      status: "rejected";
      /** Plain-language reason, safe to show or speak. */
      reason: string;
      skipped: SkippedSemanticAction[];
    };

/**
 * Grounds a whole semantic plan against the board, step by step on a
 * preview. A step that can't be grounded, or whose commands fail, is left out
 * and reported in `skipped` while the other steps still apply: one misheard
 * name in a six-step diagram shouldn't throw away the five good steps. The
 * plan is rejected only when nothing can apply, or when a left-out step
 * creates a shape that later steps build on (they would land on nothing).
 * Steps past the command limit are skipped rather than failing the plan.
 */
export function groundSemanticPlan(input: SemanticPlanGroundingInput): SemanticPlanGrounding {
  const { actions, applyCommand } = input;
  const maxCommands = input.maxCommands ?? AIRBOARD_SEMANTIC_PLAN_MAX_DIAGRAM_COMMANDS;
  if (actions.some((action) => action.type === "undo" || action.type === "cancel")) {
    return { status: "rejected", reason: "Undo and cancel are handled immediately.", skipped: [] };
  }
  const baseState = input.context.boardState;
  const autoCreateCenters = input.context.autoCreateCenters ?? computeSemanticAutoLayout({
    actions,
    boardState: baseState,
    canvasWidth: input.context.canvasWidth,
    canvasHeight: input.context.canvasHeight,
    ...(input.context.viewOrigin ? { viewOrigin: input.context.viewOrigin } : {}),
  });
  // Which later steps build on the shape or group each step creates.
  const handleUsers = new Map<string, number[]>();
  actions.forEach((action, index) => {
    for (const handle of planHandlesReferencedBy(action)) {
      handleUsers.set(handle, [...(handleUsers.get(handle) ?? []), index]);
    }
  });

  let previewState = baseState;
  const planHandles = new Map<string, string[]>();
  const missingHandles = new Set<string>();
  const commands: DiagramCommand[] = [];
  const affected: string[] = [];
  const skipped: SkippedSemanticAction[] = [];
  const repairs: Extract<SemanticPlanGrounding, { status: "grounded" }>["repairs"] = [];
  let selectionIds = input.context.selectionIds.filter(
    (id) => previewState.strokes[id]?.status === "committed" || isSceneOnlyElement(previewState, id),
  );
  let appliedActionCount = 0;

  for (const [index, action] of actions.entries()) {
    const skip = (reason: string, errorCode: SkippedSemanticAction["errorCode"]): SemanticPlanGrounding | null => {
      skipped.push({ index, actionType: action.type, reason, errorCode });
      const handle = action.type === "create" || action.type === "group" ? action.handle : null;
      if (handle && (handleUsers.get(handle) ?? []).some((user) => user > index)) {
        return {
          status: "rejected",
          reason: `A step that later steps depend on couldn't be applied: ${reason}`,
          skipped,
        };
      }
      if (handle) missingHandles.add(handle);
      return null;
    };
    if (planHandlesReferencedBy(action).some((handle) => missingHandles.has(handle))) {
      const rejected = skip("It builds on a step that was left out.", "depends_on_skipped_step");
      if (rejected) return rejected;
      continue;
    }
    const resolved = resolveSemanticPlanAction(
      action,
      { ...input.context, boardState: previewState, autoCreateCenters },
      planHandles,
    );
    if ("error" in resolved) {
      const rejected = skip(resolved.error, resolved.errorCode ?? "grounding_failed");
      if (rejected) return rejected;
      continue;
    }
    if (commands.length + resolved.commands.length > maxCommands) {
      const rejected = skip("The request is too large to apply in one go.", "command_limit");
      if (rejected) return rejected;
      continue;
    }
    // Apply the step's commands together, so a failing command leaves no half step behind.
    let stepState = previewState;
    const stepAffected: string[] = [];
    try {
      for (const command of resolved.commands) {
        const result = applyCommand(stepState, command);
        stepState = result.state;
        stepAffected.push(...result.affectedStrokeIds);
      }
    } catch (caught) {
      const rejected = skip(
        caught instanceof Error && caught.message ? caught.message : "That change couldn't be made.",
        "command_failed",
      );
      if (rejected) return rejected;
      continue;
    }
    previewState = stepState;
    commands.push(...resolved.commands);
    affected.push(...stepAffected);
    appliedActionCount += 1;
    for (const [handle, ids] of Object.entries(resolved.handleAssignments ?? {})) {
      planHandles.set(handle, ids);
    }
    if (resolved.repairKinds?.length) {
      repairs.push({ index, actionType: action.type, repairKinds: resolved.repairKinds });
    }
    if (resolved.selectionAfter) {
      selectionIds = resolved.selectionAfter.filter(
        (id) => previewState.strokes[id]?.status === "committed" || isSceneOnlyElement(previewState, id),
      );
    }
  }

  if (appliedActionCount === 0) {
    return {
      status: "rejected",
      reason: skipped[0]?.reason ?? "Nothing in that request could be applied.",
      skipped,
    };
  }
  return {
    status: "grounded",
    commands,
    previewState,
    affectedStrokeIds: [...new Set(affected)],
    selectionIds,
    primarySelectionId: selectionIds[selectionIds.length - 1] ?? null,
    appliedActionCount,
    skipped,
    repairs,
  };
}

function planHandlesReferencedBy(action: SemanticPlanAction): string[] {
  const handles: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (record.kind === "plan_handle" && typeof record.handle === "string") handles.push(record.handle);
      else Object.values(record).forEach(visit);
    }
  };
  // A create or group step's own handle is a declaration, not a reference.
  const { type: _type, ...fields } = action as Record<string, unknown>;
  visit(fields.handle !== undefined ? { ...fields, handle: undefined } : fields);
  return [...new Set(handles)];
}

export function describeSemanticPlan(actions: SemanticPlanAction[]): string {
  if (actions.length > 1) {
    const graphChanges = actions.flatMap((action): string[] => {
      if (action.type === "reverse_connection") {
        return [
          `Reverse ${describeSemanticReference(action.connection.from)} → ${describeSemanticReference(action.connection.to)}`,
        ];
      }
      if (action.type === "connect") {
        return [
          `add ${describeSemanticReference(action.from)} → ${describeSemanticReference(action.to)}`,
        ];
      }
      if (action.type === "delete_connection") {
        return [
          `remove ${describeSemanticReference(action.connection.from)} → ${describeSemanticReference(action.connection.to)}`,
        ];
      }
      return [];
    });
    if (graphChanges.length === actions.length) {
      return `${graphChanges.join(" and ")}.`;
    }
    return `Build and edit the diagram with ${actions.length} coordinated actions.`;
  }
  const action = actions[0];
  if (!action) return "Apply the diagram plan.";
  switch (action.type) {
    case "create":
      return `Create ${action.label ? `“${action.label}”` : `a ${action.nodeType}`} node.`;
    case "connect":
      return `Add ${describeSemanticReference(action.from)} → ${describeSemanticReference(action.to)}${action.label ? ` as “${action.label}”` : ""}.`;
    case "reverse_connection":
      return `Reverse ${describeSemanticReference(action.connection.from)} → ${describeSemanticReference(action.connection.to)}.`;
    case "delete_connection":
      return `Remove ${describeSemanticReference(action.connection.from)} → ${describeSemanticReference(action.connection.to)}.`;
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
    case "change_type":
      return `Change the referenced objects to ${action.shape ? action.shape.replaceAll("-", " ") : action.nodeType}.`;
    case "resize":
      return `Make the referenced objects ${action.change}.`;
    case "label_connection":
      return `Label ${describeSemanticReference(action.connection.from)} → ${describeSemanticReference(action.connection.to)} “${action.label}”.`;
    case "style_connection":
      return `Make ${describeSemanticReference(action.connection.from)} → ${describeSemanticReference(action.connection.to)} ${action.lineStyle}.`;
    case "undo":
      return "Undo the last board action.";
    case "cancel":
      return "Cancel the pending board action.";
  }
}

function describeSemanticReference(reference: SemanticObjectReference): string {
  switch (reference.kind) {
    case "visible_label":
      return reference.label;
    case "type_ordinal":
      return `${reference.nodeType === "api" ? "API" : titleCase(reference.nodeType)} ${reference.ordinal}`;
    case "current_selection":
      return "the selection";
    case "pointer":
      return "the pointed object";
    case "plan_handle":
      return titleCase(reference.handle.replaceAll("_", " "));
  }
}

function titleCase(value: string): string {
  return value.replace(/\b\p{L}/gu, (character) =>
    character.toLocaleUpperCase("en-US"),
  );
}

export function resolveIntentOperation(
  operation: IntentCanvasOperation,
  context: IntentResolutionContext,
): IntentResolution {
  // Legacy strokes (boards saved before Airo drew v2 shapes) and v2 objects
  // alike: everything this grammar creates now is v2.
  const selectionIds = context.selectionIds.filter(
    (strokeId) =>
      context.boardState.strokes[strokeId]?.status === "committed" ||
      isSceneOnlyElement(context.boardState, strokeId),
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
      const originX = context.viewOrigin?.x ?? 0;
      const originY = context.viewOrigin?.y ?? 0;
      const maxCenterX = originX + Math.max(90, context.canvasWidth - 90);
      const maxCenterY = originY + Math.max(60, context.canvasHeight - 60);
      const minCenterX = Math.min(originX + 220, maxCenterX);
      const minCenterY = Math.min(originY + 220, maxCenterY);
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

    case "attach_connection": {
      const deictic = resolveDeicticIds({
        boardState: context.boardState,
        selectionIds,
        primarySelectionId,
        hoverStrokeId: context.hoverStrokeId,
      });
      const from = resolveConnectionReference(
        operation.from,
        context.boardState,
        deictic,
      );
      if ("error" in from) return from;
      const to = resolveConnectionReference(
        operation.to,
        context.boardState,
        deictic,
      );
      if ("error" in to) return to;
      if (from.id === to.id) {
        return { error: "The source and target must be different objects." };
      }

      const candidates = findAttachableConnections(
        context.boardState,
        from.id,
        to.id,
        operation.endpointOrder ?? "directed",
      );
      const selectedCandidates = candidates.filter((candidate) =>
        selectionIds.includes(candidate.id),
      );
      const pointedCandidates = candidates.filter(
        (candidate) => candidate.id === context.hoverStrokeId,
      );
      const lineReference = operation.lineReference ?? "unique_existing";
      const chosen = lineReference === "selected"
        ? selectedCandidates.length === 1
          ? selectedCandidates[0]
          : null
        : lineReference === "pointer"
          ? pointedCandidates.length === 1
            ? pointedCandidates[0]
            : null
          : selectedCandidates.length === 1
            ? selectedCandidates[0]
            : selectedCandidates.length > 1
              ? null
              : candidates.length === 1
                ? candidates[0]
                : null;
      if (!chosen) {
        if (candidates.length === 0 && lineReference === "unique_existing") {
          const exactHealthy = [
            ...findDirectedSemanticConnections(
              context.boardState,
              from.id,
              to.id,
            ),
            ...(operation.endpointOrder === "undirected"
              ? findDirectedSemanticConnections(
                  context.boardState,
                  to.id,
                  from.id,
                )
              : []),
          ];
          if (exactHealthy.length > 0) {
            return {
              commands: [],
              selectionAfter: [from.id, to.id],
              alreadySatisfied: true,
            };
          }
        }
        return {
          error:
            lineReference === "selected"
              ? "The selected object is not one uniquely attachable disconnected line. Select the intended line and try again."
              : lineReference === "pointer"
                ? "The pointed object is not one uniquely attachable disconnected line. Point at the intended line and try again."
                : candidates.length === 0
              ? "No visually disconnected line can be safely attached to those two objects."
              : "More than one disconnected line could match. Select the intended line and try again.",
        };
      }
      return {
        commands: [
          {
            type: "connection.attach",
            connectorId: chosen.id,
            fromId: chosen.fromId,
            toId: chosen.toId,
          },
        ],
        selectionAfter: [chosen.id],
        previewStrokeId: chosen.id,
      };
    }

    case "delete_connection": {
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
      const connectionIds = findConnectionsBetween(context.boardState, from.id, to.id);
      if (connectionIds.length === 0) {
        return { error: "No connector between those two objects was found." };
      }
      if (connectionIds.length > 1 && operation.scope !== "all") {
        return {
          error:
            "More than one attached connector joins those objects. Use a labelled semantic command or remove them one at a time.",
        };
      }
      return {
        commands: [
          {
            type: "objects.delete",
            objectIds: connectionIds,
            cascadeConnectors: false,
          },
        ],
        selectionAfter: [],
      };
    }

    case "resize_selection":
    case "resize_object": {
      let targetIds: string[];
      if (operation.kind === "resize_selection") {
        if (selectionIds.length === 0) {
          return { error: "Select one or more objects before resizing." };
        }
        targetIds = selectionIds;
      } else {
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
        targetIds = [target.id];
      }
      const commands: DiagramCommand[] = [];
      for (const objectId of targetIds) {
        const bounds = isNodeObject(context.boardState, objectId)
          ? semanticObjectBounds(context.boardState, objectId)
          : null;
        if (!bounds) {
          continue;
        }
        commands.push({
          type: "object.resize",
          objectId,
          bounds: resizeBoundsAroundCenter(bounds, operation.dimension, operation.direction),
        });
      }
      if (commands.length === 0) {
        return { error: "That object has no resizable bounds — try a node or note." };
      }
      return {
        commands,
        selectionAfter: targetIds,
        previewStrokeId: targetIds[0],
      };
    }

    case "recolor_selection":
    case "recolor_object": {
      let targetIds: string[];
      if (operation.kind === "recolor_selection") {
        if (selectionIds.length === 0) {
          return { error: "Select one or more objects before recoloring." };
        }
        targetIds = selectionIds;
      } else {
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
        targetIds = [target.id];
      }
      const palette = VOICE_COLOR_PALETTE[operation.color];
      if (!palette) {
        return { error: `I don’t know the color “${operation.color}”.` };
      }
      return {
        commands: targetIds.map((objectId) => ({
          type: "object.restyle",
          objectId,
          fillColor: palette.fill,
          strokeColor: palette.stroke,
        })),
        selectionAfter: targetIds,
        previewStrokeId: targetIds[0],
      };
    }

    case "select_all": {
      const ids = [
        ...Object.values(context.boardState.strokes)
          .filter((stroke) => stroke.status === "committed" && stroke.annotation)
          .map((stroke) => stroke.id),
        ...Object.values(context.boardState.elements)
          .filter((element) => element.visible && isSceneOnlyElement(context.boardState, element.id))
          .map((element) => element.id),
      ];
      if (ids.length === 0) {
        return { error: "The board has no objects to select yet." };
      }
      return { commands: [], selectionAfter: ids };
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
  reference: Extract<
    IntentCanvasOperation,
    { kind: "connect" | "attach_connection" }
  >["from"],
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

  const search = (lookup: string, nodeTypeFilter: string | null) => {
    const candidates = nameableObjects(state).flatMap((object) => {
      if (nodeTypeFilter && object.nodeType !== nodeTypeFilter) {
        return [];
      }
      const label = normalizeObjectLookup(object.label);
      const nodeType = normalizeObjectLookup(object.nodeType);
      const exactLabel = lookup.length > 0 && label === lookup;
      const exactType = lookup.length > 0 && nodeType === lookup;
      if (!exactLabel && !exactType && !(lookup.length === 0 && nodeTypeFilter)) {
        return [];
      }
      return [{ id: object.id, exactLabel }];
    });
    const exactLabelMatches = candidates.filter((candidate) => candidate.exactLabel);
    return exactLabelMatches.length > 0 ? exactLabelMatches : candidates;
  };

  const lookup = normalizeObjectLookup(reference.normalizedLabel);
  let matches = search(lookup, null);
  if (matches.length === 0) {
    // Spoken references often append the shape kind — "the No box", "the
    // user circle". Strip a trailing type word and retry, constrained to
    // that type; a bare type word resolves when exactly one such node exists.
    const stripped = stripTrailingNodeTerm(lookup);
    if (stripped) {
      matches = search(stripped.remainder, stripped.nodeType);
    }
  }
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

/**
 * Objects this grammar can name, with the label as written (empty when it has
 * none) and the diagram type: legacy nodes on boards saved before Airo drew
 * v2 shapes, then v2 nodes.
 */
function nameableObjects(state: BoardState): Array<{ id: string; label: string; nodeType: string }> {
  const legacy = Object.values(state.strokes).flatMap((stroke) => {
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
    return [{ id: stroke.id, label: annotation.label ?? "", nodeType: annotation.nodeType ?? "" }];
  });
  const scene = Object.values(state.elements).flatMap((element) =>
    isSceneNodeElement(element) && isSceneOnlyElement(state, element.id)
      ? [{
          id: element.id,
          label: "content" in element ? richTextToPlainText(element.content).trim() : "",
          nodeType: sceneElementNodeType(element),
        }]
      : []);
  return [...legacy, ...scene];
}

/** A shape (not a line): a legacy node with a box, or a v2 node. */
function isNodeObject(state: BoardState, id: string | null | undefined): id is string {
  if (!id) return false;
  const annotation = state.strokes[id]?.annotation;
  if (annotation) return Boolean(annotation.bounds) && state.strokes[id]?.status !== "deleted";
  return isSceneOnlyElement(state, id) && isSceneNodeElement(state.elements[id]);
}

type AttachableConnection = { id: string; fromId: string; toId: string };

function findAttachableConnections(
  state: BoardState,
  firstId: string,
  secondId: string,
  endpointOrder: "directed" | "undirected",
): AttachableConnection[] {
  return Object.values(state.strokes)
    .flatMap((stroke): AttachableConnection[] => {
      const annotation = stroke.annotation;
      if (
        stroke.status !== "committed" ||
        !annotation ||
        (annotation.type !== "connector" && annotation.type !== "arrow") ||
        !annotation.start ||
        !annotation.end ||
        connectorGeometryMatchesBindings(state, annotation)
      ) {
        return [];
      }

      const startHealthy = connectorEndpointMatchesBinding(
        state,
        annotation,
        "start",
      );
      const endHealthy = connectorEndpointMatchesBinding(
        state,
        annotation,
        "end",
      );
      const orientations = endpointOrder === "undirected"
        ? [
            { fromId: firstId, toId: secondId, listedOrder: 0 },
            { fromId: secondId, toId: firstId, listedOrder: 1 },
          ]
        : [{ fromId: firstId, toId: secondId, listedOrder: 0 }];
      const viable = orientations
        .flatMap((orientation) => {
          // A healthy binding is authoritative and must never be silently
          // replaced. Missing/stale bindings are repairable only because this
          // resolver is reached by an explicit disconnected-line command.
          if (
            (startHealthy &&
              annotation.snappedStartStrokeId !== orientation.fromId) ||
            (endHealthy &&
              annotation.snappedEndStrokeId !== orientation.toId)
          ) {
            return [];
          }
          return [{
            ...orientation,
            preservedBindings: Number(startHealthy) + Number(endHealthy),
            geometryDistance:
              attachmentEndpointDistance(
                state,
                annotation.start!,
                orientation.fromId,
              ) +
              attachmentEndpointDistance(
                state,
                annotation.end!,
                orientation.toId,
              ),
          }];
        })
        .sort(
          (left, right) =>
            right.preservedBindings - left.preservedBindings ||
            left.geometryDistance - right.geometryDistance ||
            left.listedOrder - right.listedOrder,
        );
      const chosen = viable[0];
      return chosen
        ? [{ id: stroke.id, fromId: chosen.fromId, toId: chosen.toId }]
        : [];
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function attachmentEndpointDistance(
  state: BoardState,
  point: { x: number; y: number },
  nodeId: string,
): number {
  const node = state.strokes[nodeId];
  const bounds = node?.annotation?.bounds;
  if (!node || !bounds) return Number.POSITIVE_INFINITY;
  const boundary = pointOnNodeBoundary(
    bounds,
    node.annotation?.nodeType,
    point,
  );
  return Math.hypot(point.x - boundary.x, point.y - boundary.y);
}

/**
 * Voice color vocabulary → soft fill + strong stroke, chosen so labels stay
 * readable on every fill. Connectors/arrows only use the stroke half.
 */
const VOICE_COLOR_PALETTE: Readonly<Record<string, { fill: string; stroke: string }>> = {
  red: { fill: "#fee2e2", stroke: "#b91c1c" },
  blue: { fill: "#dbeafe", stroke: "#1d4ed8" },
  green: { fill: "#dcfce7", stroke: "#15803d" },
  yellow: { fill: "#fef9c3", stroke: "#a16207" },
  orange: { fill: "#ffedd5", stroke: "#c2410c" },
  purple: { fill: "#f3e8ff", stroke: "#7e22ce" },
  pink: { fill: "#fce7f3", stroke: "#be185d" },
  teal: { fill: "#ccfbf1", stroke: "#0f766e" },
  gray: { fill: "#f1f5f9", stroke: "#475569" },
  grey: { fill: "#f1f5f9", stroke: "#475569" },
  black: { fill: "#e5e7eb", stroke: "#111827" },
  white: { fill: "#ffffff", stroke: "#334155" },
  brown: { fill: "#f5ebe0", stroke: "#7c4a1e" },
};

/** Center-preserving resize: grow 1.25×, shrink 0.8×, floored at 36px. */
function resizeBoundsAroundCenter(
  bounds: { x: number; y: number; width: number; height: number },
  dimension: "width" | "height" | "both",
  direction: "grow" | "shrink",
): { x: number; y: number; width: number; height: number } {
  const factor = direction === "grow" ? 1.25 : 0.8;
  const width =
    dimension === "height" ? bounds.width : Math.max(36, bounds.width * factor);
  const height =
    dimension === "width" ? bounds.height : Math.max(36, bounds.height * factor);
  return {
    x: bounds.x + (bounds.width - width) / 2,
    y: bounds.y + (bounds.height - height) / 2,
    width,
    height,
  };
}

/**
 * Every committed connector/arrow whose endpoints join the two objects —
 * preferring explicit endpoint bindings, falling back to endpoint-in-bounds
 * geometry for lines drawn before snapping existed.
 */
function findConnectionsBetween(
  boardState: BoardState,
  firstId: string,
  secondId: string,
): string[] {
  const matches: string[] = [];
  for (const stroke of Object.values(boardState.strokes)) {
    const annotation = stroke.annotation;
    if (
      stroke.status !== "committed" ||
      !annotation ||
      (annotation.type !== "connector" && annotation.type !== "arrow")
    ) {
      continue;
    }
    const boundPair = [annotation.snappedStartStrokeId, annotation.snappedEndStrokeId];
    const hasAnyBinding = Boolean(boundPair[0] || boundPair[1]);
    if (
      (boundPair[0] === firstId && boundPair[1] === secondId) ||
      (boundPair[0] === secondId && boundPair[1] === firstId)
    ) {
      if (connectorGeometryMatchesBindings(boardState, annotation)) {
        matches.push(stroke.id);
      }
      continue;
    }
    // Geometry fallback is only for legacy lines created before endpoint
    // bindings existed. A partial or stale binding denotes a disconnected
    // line and cannot be targeted by a destructive relation command.
    if (hasAnyBinding) continue;
    if (annotation.start && annotation.end) {
      const startHit = endpointNearObject(boardState, annotation.start, firstId)
        ? firstId
        : endpointNearObject(boardState, annotation.start, secondId)
          ? secondId
          : null;
      const endHit = endpointNearObject(boardState, annotation.end, firstId)
        ? firstId
        : endpointNearObject(boardState, annotation.end, secondId)
          ? secondId
          : null;
      if (startHit && endHit && startHit !== endHit) {
        matches.push(stroke.id);
      }
    }
  }
  // v2 connectors are always bound at both ends.
  for (const connector of [
    ...sceneConnectorsBetween(boardState, firstId, secondId),
    ...sceneConnectorsBetween(boardState, secondId, firstId),
  ]) {
    if (!boardState.strokes[connector.id]) matches.push(connector.id);
  }
  return matches.sort((left, right) => left.localeCompare(right));
}

function endpointNearObject(
  boardState: BoardState,
  point: { x: number; y: number },
  objectId: string,
): boolean {
  const bounds = boardState.strokes[objectId]?.annotation?.bounds;
  if (!bounds) {
    return false;
  }
  const margin = 28;
  return (
    point.x >= bounds.x - margin &&
    point.x <= bounds.x + bounds.width + margin &&
    point.y >= bounds.y - margin &&
    point.y <= bounds.y + bounds.height + margin
  );
}

/**
 * Splits a spoken reference like "no box" / "user circle" into its label
 * prefix and a trailing shape word. Generic words (box/node/shape/object)
 * strip without a type constraint.
 */
function stripTrailingNodeTerm(
  lookup: string,
): { remainder: string; nodeType: string | null } | null {
  const words = lookup.split(" ").filter(Boolean);
  if (words.length === 0) {
    return null;
  }
  const last = words[words.length - 1]!;
  const generic = new Set(["box", "node", "shape", "object"]);
  for (const capability of AIRBOARD_SEMANTIC_NODE_CAPABILITIES) {
    for (const term of capability.terms) {
      if (normalizeObjectLookup(term) === last) {
        return { remainder: words.slice(0, -1).join(" "), nodeType: capability.nodeType };
      }
    }
  }
  if (generic.has(last) && words.length > 1) {
    return { remainder: words.slice(0, -1).join(" "), nodeType: null };
  }
  return null;
}

function normalizeObjectLookup(value: string): string {
  return normalizeSpokenNumberAliases(value);
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
      x:
        (context.viewOrigin?.x ?? 0) +
        (placement.direction === "left" ? context.canvasWidth * 0.25 : context.canvasWidth * 0.75),
      y: (context.viewOrigin?.y ?? 0) + context.canvasHeight * 0.5,
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
  const bounds = isNodeObject(context.boardState, referenceId)
    ? semanticObjectBounds(context.boardState, referenceId)
    : null;
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
  const isNode = (strokeId: string | null): strokeId is string => isNodeObject(input.boardState, strokeId);
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
  direction: Exclude<SemanticLayoutDirection, "tree" | "radial">,
): DiagramCommand[] {
  const entries = selectionIds.flatMap((strokeId) => {
    const bounds = semanticObjectBounds(state, strokeId);
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
  return ordered.flatMap((entry, index) => {
    const column = direction === "grid" ? index % columns : horizontal ? index : 0;
    const row = direction === "grid" ? Math.floor(index / columns) : horizontal ? 0 : index;
    return splitMoveByWorld(state, {
      type: "objects.move",
      objectIds: [entry.strokeId],
      to: {
        x: minX + column * (maxWidth + 48),
        y: minY + row * (maxHeight + 44),
      },
    });
  });
}

/** Connectors among a set of objects, legacy or v2, as from → to pairs. */
function semanticEdgesAmong(state: BoardState, ids: readonly string[]): Array<{ from: string; to: string }> {
  const members = new Set(ids);
  const edges: Array<{ from: string; to: string }> = [];
  for (const stroke of Object.values(state.strokes)) {
    const annotation = stroke.annotation;
    if (
      stroke.status === "committed" &&
      (annotation?.type === "connector" || annotation?.type === "arrow") &&
      annotation.snappedStartStrokeId && members.has(annotation.snappedStartStrokeId) &&
      annotation.snappedEndStrokeId && members.has(annotation.snappedEndStrokeId)
    ) {
      edges.push({ from: annotation.snappedStartStrokeId, to: annotation.snappedEndStrokeId });
    }
  }
  for (const element of Object.values(state.elements)) {
    if (
      element.kind === "connector" &&
      element.status === "active" &&
      !element.legacyStrokeId &&
      element.start.binding && members.has(element.start.binding.elementId) &&
      element.end.binding && members.has(element.end.binding.elementId)
    ) {
      edges.push({ from: element.start.binding.elementId, to: element.end.binding.elementId });
    }
  }
  return edges;
}

/** Moves each object so its center lands on a point, through its own world's command. */
function moveCentersCommands(
  state: BoardState,
  centers: ReadonlyMap<string, AnnotationPoint>,
): DiagramCommand[] {
  return [...centers].flatMap(([id, center]) => {
    const bounds = semanticObjectBounds(state, id);
    if (!bounds) return [];
    const to = { x: center.x - bounds.width / 2, y: center.y - bounds.height / 2 };
    if (Math.abs(to.x - bounds.x) < 0.5 && Math.abs(to.y - bounds.y) < 0.5) return [];
    return splitMoveByWorld(state, { type: "objects.move", objectIds: [id], to });
  });
}

/**
 * Lays objects out as a top-down tree that follows their arrows: objects no
 * arrow points into are the roots, and each level sits one row lower than its
 * parents. Objects the arrows don't reach start trees of their own. The tree
 * is centered where the objects were, so it doesn't jump across the board.
 */
function createTreeLayoutCommands(state: BoardState, ids: string[]): DiagramCommand[] {
  const bounds = ids.flatMap((id) => {
    const value = semanticObjectBounds(state, id);
    return value ? [{ id, bounds: value }] : [];
  });
  if (bounds.length === 0) return [];
  const known = new Set(bounds.map(({ id }) => id));
  const readingOrder = semanticBoardNodes(state).map(({ id }) => id).filter((id) => known.has(id));
  for (const { id } of bounds) if (!readingOrder.includes(id)) readingOrder.push(id);
  const edges = semanticEdgesAmong(state, readingOrder);
  const children = new Map(readingOrder.map((id) => [id, [] as string[]]));
  const hasParent = new Set<string>();
  for (const { from, to } of edges) {
    if (from === to || children.get(from)!.includes(to)) continue;
    children.get(from)!.push(to);
    hasParent.add(to);
  }
  const depth = new Map<string, number>();
  const levels: string[][] = [];
  const visit = (roots: string[]) => {
    let frontier = roots.filter((id) => !depth.has(id));
    for (const id of frontier) depth.set(id, 0);
    let level = 0;
    while (frontier.length > 0) {
      levels[level] = [...(levels[level] ?? []), ...frontier];
      const next: string[] = [];
      for (const id of frontier) {
        for (const child of children.get(id) ?? []) {
          if (depth.has(child)) continue;
          depth.set(child, level + 1);
          next.push(child);
        }
      }
      frontier = next;
      level += 1;
    }
  };
  visit(readingOrder.filter((id) => !hasParent.has(id)));
  // A cycle has no root: start from the first object left in reading order.
  for (const id of readingOrder) if (!depth.has(id)) visit([id]);

  const maxWidth = Math.max(...bounds.map(({ bounds: value }) => value.width));
  const maxHeight = Math.max(...bounds.map(({ bounds: value }) => value.height));
  const group = semanticSelectionBounds(state, readingOrder)!;
  const centerX = group.x + group.width / 2;
  const columnStep = maxWidth + 56;
  const rowStep = maxHeight + 96;
  const centers = new Map<string, AnnotationPoint>();
  levels.forEach((level, row) => {
    level.forEach((id, column) => {
      centers.set(id, {
        x: centerX + (column - (level.length - 1) / 2) * columnStep,
        y: group.y + maxHeight / 2 + row * rowStep,
      });
    });
  });
  return moveCentersCommands(state, centers);
}

/**
 * Hub-and-spoke: the first object stays where it is as the hub and the rest
 * go round it in a circle, starting at the top and going clockwise. The ring
 * grows with the number of spokes so neighbours don't overlap.
 */
function createRadialLayoutCommands(state: BoardState, ids: string[]): DiagramCommand[] {
  const [hubId, ...spokes] = ids.filter((id) => semanticObjectBounds(state, id));
  if (!hubId || spokes.length === 0) return [];
  const hub = semanticObjectBounds(state, hubId)!;
  const hubCenter = { x: hub.x + hub.width / 2, y: hub.y + hub.height / 2 };
  const spokeSize = Math.max(...spokes.map((id) => {
    const value = semanticObjectBounds(state, id)!;
    return Math.max(value.width, value.height);
  }));
  const radius = Math.max(
    Math.max(hub.width, hub.height) / 2 + spokeSize / 2 + 96,
    (spokes.length * (spokeSize + 40)) / (2 * Math.PI),
  );
  const centers = new Map<string, AnnotationPoint>();
  spokes.forEach((id, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / spokes.length;
    centers.set(id, {
      x: hubCenter.x + Math.cos(angle) * radius,
      y: hubCenter.y + Math.sin(angle) * radius,
    });
  });
  return moveCentersCommands(state, centers);
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
  // Airo's own nodes and the shapes typed commands and the toolbar make,
  // in reading order (RGB-039).
  const nodes = semanticBoardNodes(boardState).slice(0, 80);
  const ordinalsByType = new Map<string, number>();
  const summariesById = new Map<string, SemanticIntentContext["objects"][number]>();

  for (const node of nodes) {
    const { bounds, nodeType } = node;
    const ordinal = (ordinalsByType.get(nodeType) ?? 0) + 1;
    ordinalsByType.set(nodeType, ordinal);
    const summary = {
      label: (node.label || `${nodeType} ${ordinal}`).slice(0, 120),
      nodeType: nodeType.slice(0, 40),
      ordinal,
      selected: selectedIds.has(node.id),
      position: {
        x: Math.round(bounds.x + bounds.width / 2),
        y: Math.round(bounds.y + bounds.height / 2),
      },
      size: {
        width: Math.round(bounds.width),
        height: Math.round(bounds.height),
      },
    };
    summariesById.set(node.id, summary);
  }

  const objects = [...summariesById.values()];
  const selected = objects.filter((summary) => summary.selected).slice(0, 20);
  const edges: SemanticIntentContext["edges"] = [];
  const edgeOccurrences = new Map<string, number>();
  for (const stroke of Object.values(boardState.strokes).sort((left, right) =>
    left.id.localeCompare(right.id)
  )) {
    const annotation = stroke.annotation;
    if (
      stroke.status !== "committed" ||
      !annotation ||
      (annotation.type !== "connector" && annotation.type !== "arrow") ||
      !annotation.snappedStartStrokeId ||
      !annotation.snappedEndStrokeId ||
      !connectorGeometryMatchesBindings(boardState, annotation) ||
      edges.length >= 120
    ) {
      continue;
    }
    const from = summariesById.get(annotation.snappedStartStrokeId);
    const to = summariesById.get(annotation.snappedEndStrokeId);
    if (!from || !to) {
      continue;
    }
    const occurrenceKey = `${annotation.snappedStartStrokeId}\u0000${annotation.snappedEndStrokeId}`;
    const occurrence = (edgeOccurrences.get(occurrenceKey) ?? 0) + 1;
    edgeOccurrences.set(occurrenceKey, occurrence);
    edges.push({
      from: { label: from.label, nodeType: from.nodeType, ordinal: from.ordinal },
      to: { label: to.label, nodeType: to.nodeType, ordinal: to.ordinal },
      ...(annotation.label?.trim() ? { label: annotation.label.trim().slice(0, 80) } : {}),
      occurrence,
    });
  }
  // v2 connectors, whichever kind of object each end is bound to.
  for (const element of Object.values(boardState.elements).sort((left, right) => left.id.localeCompare(right.id))) {
    if (
      element.kind !== "connector" ||
      element.status !== "active" ||
      element.legacyStrokeId ||
      !element.start.binding ||
      !element.end.binding ||
      edges.length >= 120
    ) {
      continue;
    }
    const from = summariesById.get(element.start.binding.elementId);
    const to = summariesById.get(element.end.binding.elementId);
    if (!from || !to) continue;
    const occurrenceKey = `${element.start.binding.elementId}\u0000${element.end.binding.elementId}`;
    const occurrence = (edgeOccurrences.get(occurrenceKey) ?? 0) + 1;
    edgeOccurrences.set(occurrenceKey, occurrence);
    const label = richTextToPlainText(element.label).trim();
    edges.push({
      from: { label: from.label, nodeType: from.nodeType, ordinal: from.ordinal },
      to: { label: to.label, nodeType: to.nodeType, ordinal: to.ordinal },
      ...(label ? { label: label.slice(0, 80) } : {}),
      occurrence,
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
