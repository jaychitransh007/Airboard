import {
  nodeVisualDefaultSize,
  type AnnotationBounds,
  type AnnotationNodeType,
  type AnnotationPoint,
  type BoardState,
  type SemanticObjectReference,
  type SemanticPlanAction,
} from "@airboard/core";

/**
 * Minimum clear space between automatically placed node bounds. This is a
 * board-space distance, so zooming the viewport cannot collapse the layout.
 */
export const SEMANTIC_AUTO_LAYOUT_GAP = 88;

const VIEW_PADDING = 24;

export type SemanticAutoLayoutInput = {
  actions: readonly SemanticPlanAction[];
  boardState: BoardState;
  canvasWidth: number;
  canvasHeight: number;
  viewOrigin?: AnnotationPoint;
};

type LayoutNode = {
  actionIndex: number;
  handle: string;
  nodeType: AnnotationNodeType;
  size: { width: number; height: number };
};

type LayoutColumn = {
  nodes: LayoutNode[];
  width: number;
  height: number;
};

/**
 * Compute stable centers for the auto-created portion of a semantic plan.
 *
 * Cycles are condensed before ranking, so a request/response pair stays in one
 * vertical column while downstream steps advance left-to-right. The complete
 * block is centered and translated as one unit; individual nodes are never
 * clamped onto the same canvas edge.
 */
export function computeSemanticAutoLayout({
  actions,
  boardState,
  canvasWidth,
  canvasHeight,
  viewOrigin = { x: 0, y: 0 },
}: SemanticAutoLayoutInput): Map<string, AnnotationPoint> {
  const nodes = autoCreateNodes(actions);
  if (nodes.length === 0) {
    return new Map();
  }

  const nodeIndexByHandle = new Map(
    nodes.map((node, index) => [node.handle, index]),
  );
  const adjacency = nodes.map(() => new Set<number>());
  for (const action of actions) {
    if (action.type === "connect") {
      addPlanHandleEdge(
        action.from,
        action.to,
        nodeIndexByHandle,
        adjacency,
      );
      continue;
    }
    if (action.type === "branch") {
      for (const branch of action.branches) {
        addPlanHandleEdge(
          action.from,
          branch.to,
          nodeIndexByHandle,
          adjacency,
        );
      }
    }
  }

  const components = stronglyConnectedComponents(adjacency);
  const componentByNode = new Array<number>(nodes.length);
  components.forEach((component, componentIndex) => {
    for (const nodeIndex of component) {
      componentByNode[nodeIndex] = componentIndex;
    }
  });
  const componentRanks = rankComponents(
    components,
    componentByNode,
    adjacency,
  );
  const columns = layoutColumns(nodes, componentByNode, componentRanks);
  const blockWidth =
    columns.reduce((total, column) => total + column.width, 0) +
    SEMANTIC_AUTO_LAYOUT_GAP * Math.max(0, columns.length - 1);
  const blockHeight = Math.max(...columns.map((column) => column.height));
  const viewport = {
    x: finiteNumber(viewOrigin.x, 0),
    y: finiteNumber(viewOrigin.y, 0),
    width: finitePositive(canvasWidth, 1),
    height: finitePositive(canvasHeight, 1),
  };
  const idealBounds = centeredBlockBounds(
    viewport,
    blockWidth,
    blockHeight,
  );
  const blockBounds = avoidExistingNodes(
    idealBounds,
    viewport,
    existingNodeBounds(boardState),
  );

  const centers = new Map<string, AnnotationPoint>();
  let columnX = blockBounds.x;
  for (const column of columns) {
    const centerX = columnX + column.width / 2;
    let nodeY =
      blockBounds.y + (blockBounds.height - column.height) / 2;
    for (const node of column.nodes) {
      centers.set(node.handle, {
        x: centerX,
        y: nodeY + node.size.height / 2,
      });
      nodeY += node.size.height + SEMANTIC_AUTO_LAYOUT_GAP;
    }
    columnX += column.width + SEMANTIC_AUTO_LAYOUT_GAP;
  }
  return centers;
}

function autoCreateNodes(
  actions: readonly SemanticPlanAction[],
): LayoutNode[] {
  return actions.flatMap((action, actionIndex): LayoutNode[] => {
    if (
      action.type !== "create" ||
      action.placement.kind !== "auto"
    ) {
      return [];
    }
    return [
      {
        actionIndex,
        handle: action.handle,
        nodeType: action.nodeType,
        size: nodeVisualDefaultSize(action.nodeType),
      },
    ];
  });
}

function addPlanHandleEdge(
  from: SemanticObjectReference,
  to: SemanticObjectReference,
  nodeIndexByHandle: ReadonlyMap<string, number>,
  adjacency: Array<Set<number>>,
): void {
  if (from.kind !== "plan_handle" || to.kind !== "plan_handle") {
    return;
  }
  const fromIndex = nodeIndexByHandle.get(from.handle);
  const toIndex = nodeIndexByHandle.get(to.handle);
  if (fromIndex === undefined || toIndex === undefined) {
    return;
  }
  adjacency[fromIndex]?.add(toIndex);
}

/**
 * Tarjan's algorithm, with action-order traversal and component/member sorting
 * to make the same plan byte-for-byte stable across runs.
 */
function stronglyConnectedComponents(
  adjacency: ReadonlyArray<ReadonlySet<number>>,
): number[][] {
  const indices = new Array<number>(adjacency.length).fill(-1);
  const lowLinks = new Array<number>(adjacency.length).fill(-1);
  const stack: number[] = [];
  const onStack = new Set<number>();
  const components: number[][] = [];
  let nextIndex = 0;

  const visit = (nodeIndex: number): void => {
    indices[nodeIndex] = nextIndex;
    lowLinks[nodeIndex] = nextIndex;
    nextIndex += 1;
    stack.push(nodeIndex);
    onStack.add(nodeIndex);

    const neighbors = [...(adjacency[nodeIndex] ?? [])].sort(
      (left, right) => left - right,
    );
    for (const neighbor of neighbors) {
      if (indices[neighbor] === -1) {
        visit(neighbor);
        lowLinks[nodeIndex] = Math.min(
          lowLinks[nodeIndex] ?? 0,
          lowLinks[neighbor] ?? 0,
        );
      } else if (onStack.has(neighbor)) {
        lowLinks[nodeIndex] = Math.min(
          lowLinks[nodeIndex] ?? 0,
          indices[neighbor] ?? 0,
        );
      }
    }

    if (lowLinks[nodeIndex] !== indices[nodeIndex]) {
      return;
    }
    const component: number[] = [];
    while (stack.length > 0) {
      const member = stack.pop();
      if (member === undefined) {
        break;
      }
      onStack.delete(member);
      component.push(member);
      if (member === nodeIndex) {
        break;
      }
    }
    component.sort((left, right) => left - right);
    components.push(component);
  };

  for (let nodeIndex = 0; nodeIndex < adjacency.length; nodeIndex += 1) {
    if (indices[nodeIndex] === -1) {
      visit(nodeIndex);
    }
  }
  return components.sort(
    (left, right) => (left[0] ?? 0) - (right[0] ?? 0),
  );
}

function rankComponents(
  components: readonly number[][],
  componentByNode: readonly number[],
  adjacency: ReadonlyArray<ReadonlySet<number>>,
): number[] {
  const componentAdjacency = components.map(() => new Set<number>());
  const indegrees = components.map(() => 0);
  for (let fromNode = 0; fromNode < adjacency.length; fromNode += 1) {
    const fromComponent = componentByNode[fromNode];
    if (fromComponent === undefined) {
      continue;
    }
    for (const toNode of adjacency[fromNode] ?? []) {
      const toComponent = componentByNode[toNode];
      if (
        toComponent === undefined ||
        toComponent === fromComponent ||
        componentAdjacency[fromComponent]?.has(toComponent)
      ) {
        continue;
      }
      componentAdjacency[fromComponent]?.add(toComponent);
      indegrees[toComponent] = (indegrees[toComponent] ?? 0) + 1;
    }
  }

  const ranks = components.map(() => 0);
  const ready = indegrees
    .flatMap((indegree, componentIndex) =>
      indegree === 0 ? [componentIndex] : [],
    )
    .sort((left, right) => left - right);
  while (ready.length > 0) {
    const componentIndex = ready.shift();
    if (componentIndex === undefined) {
      break;
    }
    const targets = [
      ...(componentAdjacency[componentIndex] ?? []),
    ].sort((left, right) => left - right);
    for (const target of targets) {
      ranks[target] = Math.max(
        ranks[target] ?? 0,
        (ranks[componentIndex] ?? 0) + 1,
      );
      indegrees[target] = (indegrees[target] ?? 0) - 1;
      if (indegrees[target] === 0) {
        ready.push(target);
        ready.sort((left, right) => left - right);
      }
    }
  }
  return ranks;
}

function layoutColumns(
  nodes: readonly LayoutNode[],
  componentByNode: readonly number[],
  componentRanks: readonly number[],
): LayoutColumn[] {
  const nodesByRank = new Map<number, LayoutNode[]>();
  nodes.forEach((node, nodeIndex) => {
    const componentIndex = componentByNode[nodeIndex] ?? 0;
    const rank = componentRanks[componentIndex] ?? 0;
    const ranked = nodesByRank.get(rank) ?? [];
    ranked.push(node);
    nodesByRank.set(rank, ranked);
  });

  return [...nodesByRank.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, rankedNodes]) => {
      const ordered = [...rankedNodes].sort(
        (left, right) => left.actionIndex - right.actionIndex,
      );
      return {
        nodes: ordered,
        width: Math.max(...ordered.map((node) => node.size.width)),
        height:
          ordered.reduce(
            (total, node) => total + node.size.height,
            0,
          ) +
          SEMANTIC_AUTO_LAYOUT_GAP * Math.max(0, ordered.length - 1),
      };
    });
}

function centeredBlockBounds(
  viewport: AnnotationBounds,
  width: number,
  height: number,
): AnnotationBounds {
  const centered = {
    x: viewport.x + (viewport.width - width) / 2,
    y: viewport.y + (viewport.height - height) / 2,
    width,
    height,
  };
  if (width <= Math.max(0, viewport.width - VIEW_PADDING * 2)) {
    centered.x = clamp(
      centered.x,
      viewport.x + VIEW_PADDING,
      viewport.x + viewport.width - VIEW_PADDING - width,
    );
  }
  if (height <= Math.max(0, viewport.height - VIEW_PADDING * 2)) {
    centered.y = clamp(
      centered.y,
      viewport.y + VIEW_PADDING,
      viewport.y + viewport.height - VIEW_PADDING - height,
    );
  }
  return centered;
}

function existingNodeBounds(state: BoardState): AnnotationBounds[] {
  return Object.values(state.strokes)
    .flatMap((stroke): AnnotationBounds[] => {
      const annotation = stroke.annotation;
      return stroke.status === "committed" &&
        annotation?.nodeType &&
        annotation.bounds
        ? [{ ...annotation.bounds }]
        : [];
    })
    .sort(
      (left, right) =>
        left.y - right.y ||
        left.x - right.x ||
        left.width - right.width ||
        left.height - right.height,
    );
}

/**
 * The layout's internal coordinates never change here. Candidate translations
 * come from viewport and obstacle edges, then the nearest valid whole-block
 * translation wins. Off-viewport overflow is penalized before distance, so a
 * fitting placement is preferred whenever one exists.
 */
function avoidExistingNodes(
  ideal: AnnotationBounds,
  viewport: AnnotationBounds,
  obstacles: readonly AnnotationBounds[],
): AnnotationBounds {
  if (obstacles.length === 0) {
    return ideal;
  }
  const xCandidates = new Set<number>([
    ideal.x,
    viewport.x + VIEW_PADDING,
    viewport.x + viewport.width - VIEW_PADDING - ideal.width,
  ]);
  const yCandidates = new Set<number>([
    ideal.y,
    viewport.y + VIEW_PADDING,
    viewport.y + viewport.height - VIEW_PADDING - ideal.height,
  ]);
  for (const obstacle of obstacles) {
    xCandidates.add(
      obstacle.x + obstacle.width + SEMANTIC_AUTO_LAYOUT_GAP,
    );
    xCandidates.add(
      obstacle.x - SEMANTIC_AUTO_LAYOUT_GAP - ideal.width,
    );
    yCandidates.add(
      obstacle.y + obstacle.height + SEMANTIC_AUTO_LAYOUT_GAP,
    );
    yCandidates.add(
      obstacle.y - SEMANTIC_AUTO_LAYOUT_GAP - ideal.height,
    );
  }

  const candidates = [...xCandidates].flatMap((x) =>
    [...yCandidates].map((y) => ({
      x,
      y,
      width: ideal.width,
      height: ideal.height,
    })),
  );
  const valid = candidates.filter((candidate) =>
    obstacles.every(
      (obstacle) =>
        !boundsOverlap(
          candidate,
          expandBounds(obstacle, SEMANTIC_AUTO_LAYOUT_GAP),
        ),
    ),
  );
  const ranked = (valid.length > 0 ? valid : candidates).sort(
    (left, right) =>
      overflowDistance(left, viewport) -
        overflowDistance(right, viewport) ||
      squaredDistance(left, ideal) - squaredDistance(right, ideal) ||
      left.y - right.y ||
      left.x - right.x,
  );
  return ranked[0] ?? ideal;
}

function expandBounds(
  bounds: AnnotationBounds,
  amount: number,
): AnnotationBounds {
  return {
    x: bounds.x - amount,
    y: bounds.y - amount,
    width: bounds.width + amount * 2,
    height: bounds.height + amount * 2,
  };
}

function boundsOverlap(
  left: AnnotationBounds,
  right: AnnotationBounds,
): boolean {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  );
}

function overflowDistance(
  bounds: AnnotationBounds,
  viewport: AnnotationBounds,
): number {
  return (
    Math.max(0, viewport.x - bounds.x) +
    Math.max(
      0,
      bounds.x + bounds.width - (viewport.x + viewport.width),
    ) +
    Math.max(0, viewport.y - bounds.y) +
    Math.max(
      0,
      bounds.y + bounds.height - (viewport.y + viewport.height),
    )
  );
}

function squaredDistance(
  left: Pick<AnnotationBounds, "x" | "y">,
  right: Pick<AnnotationBounds, "x" | "y">,
): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function finiteNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
