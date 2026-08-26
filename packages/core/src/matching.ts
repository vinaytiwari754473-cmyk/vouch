import { compareCodeUnits } from "./canonical";

export interface BipartiteEdge {
  readonly left: string;
  readonly right: string;
}

export interface MatchingAnalysis {
  readonly cardinality: number;
  readonly selectedEdges: readonly BipartiteEdge[];
  readonly possibleEdges: readonly BipartiteEdge[];
  readonly requiredEdges: readonly BipartiteEdge[];
  readonly ambiguousLeft: readonly string[];
  readonly ambiguousRight: readonly string[];
  readonly unmatchedLeft: readonly string[];
  readonly unmatchedRight: readonly string[];
}

function edgeKey(edge: BipartiteEdge): string {
  return `${edge.left}\u0000${edge.right}`;
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareCodeUnits);
}

function normalizeEdges(edges: readonly BipartiteEdge[]): BipartiteEdge[] {
  const byKey = new Map<string, BipartiteEdge>();
  for (const edge of edges) {
    byKey.set(edgeKey(edge), { left: edge.left, right: edge.right });
  }
  return [...byKey.values()].sort((left, right) =>
    compareCodeUnits(edgeKey(left), edgeKey(right)),
  );
}

export function maximumMatching(
  leftVertices: readonly string[],
  rightVertices: readonly string[],
  edges: readonly BipartiteEdge[],
): readonly BipartiteEdge[] {
  const left = sortedUnique(leftVertices);
  const rightSet = new Set(sortedUnique(rightVertices));
  const adjacency = new Map<string, string[]>();
  for (const vertex of left) adjacency.set(vertex, []);
  for (const edge of normalizeEdges(edges)) {
    if (adjacency.has(edge.left) && rightSet.has(edge.right)) {
      adjacency.get(edge.left)?.push(edge.right);
    }
  }
  for (const neighbours of adjacency.values()) neighbours.sort(compareCodeUnits);

  const ownerByRight = new Map<string, string>();
  const seek = (leftId: string, seenRight: Set<string>): boolean => {
    for (const rightId of adjacency.get(leftId) ?? []) {
      if (seenRight.has(rightId)) continue;
      seenRight.add(rightId);
      const owner = ownerByRight.get(rightId);
      if (owner === undefined || seek(owner, seenRight)) {
        ownerByRight.set(rightId, leftId);
        return true;
      }
    }
    return false;
  };

  for (const leftId of left) seek(leftId, new Set<string>());
  return [...ownerByRight.entries()]
    .map(([rightId, leftId]) => ({ left: leftId, right: rightId }))
    .sort((a, b) => compareCodeUnits(edgeKey(a), edgeKey(b)));
}

function withoutEdge(
  edges: readonly BipartiteEdge[],
  excluded: BipartiteEdge,
): BipartiteEdge[] {
  const excludedKey = edgeKey(excluded);
  return edges.filter((edge) => edgeKey(edge) !== excludedKey);
}

function withoutVertices(
  leftVertices: readonly string[],
  rightVertices: readonly string[],
  edges: readonly BipartiteEdge[],
  left: string,
  right: string,
): {
  leftVertices: string[];
  rightVertices: string[];
  edges: BipartiteEdge[];
} {
  return {
    leftVertices: leftVertices.filter((value) => value !== left),
    rightVertices: rightVertices.filter((value) => value !== right),
    edges: edges.filter((edge) => edge.left !== left && edge.right !== right),
  };
}

export function analyzeMatching(
  leftVertices: readonly string[],
  rightVertices: readonly string[],
  inputEdges: readonly BipartiteEdge[],
): MatchingAnalysis {
  const left = sortedUnique(leftVertices);
  const right = sortedUnique(rightVertices);
  const edges = normalizeEdges(inputEdges);
  const selectedEdges = maximumMatching(left, right, edges);
  const cardinality = selectedEdges.length;

  const possibleEdges = edges.filter((edge) => {
    const reduced = withoutVertices(left, right, edges, edge.left, edge.right);
    return 1 + maximumMatching(
      reduced.leftVertices,
      reduced.rightVertices,
      reduced.edges,
    ).length === cardinality;
  });

  const requiredEdges = possibleEdges.filter(
    (edge) => maximumMatching(left, right, withoutEdge(edges, edge)).length < cardinality,
  );

  const requiredLeft = new Set(requiredEdges.map((edge) => edge.left));
  const requiredRight = new Set(requiredEdges.map((edge) => edge.right));
  const possibleLeft = new Set(possibleEdges.map((edge) => edge.left));
  const possibleRight = new Set(possibleEdges.map((edge) => edge.right));

  if (requiredLeft.size !== requiredEdges.length || requiredRight.size !== requiredEdges.length) {
    throw new Error("matching invariant failed: required edges are not one-to-one");
  }

  return {
    cardinality,
    selectedEdges,
    possibleEdges,
    requiredEdges,
    ambiguousLeft: left.filter((value) => possibleLeft.has(value) && !requiredLeft.has(value)),
    ambiguousRight: right.filter((value) => possibleRight.has(value) && !requiredRight.has(value)),
    unmatchedLeft: left.filter((value) => !possibleLeft.has(value)),
    unmatchedRight: right.filter((value) => !possibleRight.has(value)),
  };
}
