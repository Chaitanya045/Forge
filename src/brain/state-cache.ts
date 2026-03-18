import { fsReadFile, fsWriteFile } from "../tools/system/fs";
import { getBrainPaths } from "./paths";
import {
  createInitialCurrentPlan,
  createInitialWorkingMemory,
  currentPlanSchema,
  fileImportanceSchema,
  memoryGraphEdgesSchema,
  memoryGraphNodesSchema,
  type CurrentPlan,
  type FileImportanceMap,
  type MemoryGraphEdge,
  type MemoryGraphNode,
  type WorkingMemory,
  workingMemorySchema,
} from "./types";

function createInitialFileImportanceMap(): FileImportanceMap {
  return {};
}

function createInitialMemoryGraphEdges(): MemoryGraphEdge[] {
  return [];
}

function createInitialMemoryGraphNodes(): MemoryGraphNode[] {
  return [];
}

type BrainStateCacheEntry = {
  currentPlan?: CurrentPlan | Promise<CurrentPlan>;
  fileImportance?: FileImportanceMap | Promise<FileImportanceMap>;
  graphEdges?: MemoryGraphEdge[] | Promise<MemoryGraphEdge[]>;
  graphNodes?: MemoryGraphNode[] | Promise<MemoryGraphNode[]>;
  identity?: Promise<string> | string;
  workingMemory?: Promise<WorkingMemory> | WorkingMemory;
};

const brainStateCacheByWorkspace = new Map<string, BrainStateCacheEntry>();

function getCacheEntry(workspaceRoot: string): BrainStateCacheEntry {
  const existing = brainStateCacheByWorkspace.get(workspaceRoot);
  if (existing) {
    return existing;
  }

  const created: BrainStateCacheEntry = {};
  brainStateCacheByWorkspace.set(workspaceRoot, created);
  return created;
}

async function parseJsonFile<T>(
  pathValue: string,
  safeParse: (value: unknown) => {
    data?: T;
    success: boolean;
  },
  fallback: T
): Promise<T> {
  try {
    const content = await fsReadFile(pathValue, "utf8");
    const parsed = JSON.parse(content) as unknown;
    const validated = safeParse(parsed);
    return validated.success && validated.data !== undefined ? validated.data : fallback;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return fallback;
    }

    return fallback;
  }
}

async function loadIdentity(workspaceRoot: string): Promise<string> {
  const paths = getBrainPaths(workspaceRoot);

  try {
    return await fsReadFile(paths.identityFile, "utf8");
  } catch {
    return "";
  }
}

async function loadCurrentPlan(workspaceRoot: string): Promise<CurrentPlan> {
  const paths = getBrainPaths(workspaceRoot);
  return await parseJsonFile(
    paths.currentPlanFile,
    (value) => currentPlanSchema.safeParse(value),
    createInitialCurrentPlan()
  );
}

async function loadWorkingMemory(workspaceRoot: string): Promise<WorkingMemory> {
  const paths = getBrainPaths(workspaceRoot);
  return await parseJsonFile(
    paths.workingMemoryFile,
    (value) => workingMemorySchema.safeParse(value),
    createInitialWorkingMemory()
  );
}

async function loadMemoryGraphNodes(workspaceRoot: string): Promise<MemoryGraphNode[]> {
  const paths = getBrainPaths(workspaceRoot);
  return await parseJsonFile(
    paths.nodesFile,
    (value) => memoryGraphNodesSchema.safeParse(value),
    createInitialMemoryGraphNodes()
  );
}

async function loadMemoryGraphEdges(workspaceRoot: string): Promise<MemoryGraphEdge[]> {
  const paths = getBrainPaths(workspaceRoot);
  return await parseJsonFile(
    paths.edgesFile,
    (value) => memoryGraphEdgesSchema.safeParse(value),
    createInitialMemoryGraphEdges()
  );
}

async function loadFileImportance(workspaceRoot: string): Promise<FileImportanceMap> {
  const paths = getBrainPaths(workspaceRoot);
  return await parseJsonFile(
    paths.fileImportanceFile,
    (value) => fileImportanceSchema.safeParse(value),
    createInitialFileImportanceMap()
  );
}

export async function getCachedIdentity(workspaceRoot: string): Promise<string> {
  const cache = getCacheEntry(workspaceRoot);
  if (cache.identity !== undefined) {
    return await cache.identity;
  }

  const pending = loadIdentity(workspaceRoot);
  cache.identity = pending;
  const resolved = await pending;
  cache.identity = resolved;
  return resolved;
}

export async function getCachedCurrentPlan(workspaceRoot: string): Promise<CurrentPlan> {
  const cache = getCacheEntry(workspaceRoot);
  if (cache.currentPlan !== undefined) {
    return await cache.currentPlan;
  }

  const pending = loadCurrentPlan(workspaceRoot);
  cache.currentPlan = pending;
  const resolved = await pending;
  cache.currentPlan = resolved;
  return resolved;
}

export function setCachedCurrentPlan(workspaceRoot: string, currentPlan: CurrentPlan): void {
  getCacheEntry(workspaceRoot).currentPlan = currentPlan;
}

export async function writeCachedCurrentPlan(
  workspaceRoot: string,
  currentPlan: CurrentPlan,
  serializedCurrentPlan: string
): Promise<void> {
  const paths = getBrainPaths(workspaceRoot);
  await fsWriteFile(paths.currentPlanFile, serializedCurrentPlan, "utf8");
  setCachedCurrentPlan(workspaceRoot, currentPlan);
}

export async function getCachedWorkingMemory(workspaceRoot: string): Promise<WorkingMemory> {
  const cache = getCacheEntry(workspaceRoot);
  if (cache.workingMemory !== undefined) {
    return await cache.workingMemory;
  }

  const pending = loadWorkingMemory(workspaceRoot);
  cache.workingMemory = pending;
  const resolved = await pending;
  cache.workingMemory = resolved;
  return resolved;
}

export function setCachedWorkingMemory(workspaceRoot: string, workingMemory: WorkingMemory): void {
  getCacheEntry(workspaceRoot).workingMemory = workingMemory;
}

export async function writeCachedWorkingMemory(
  workspaceRoot: string,
  workingMemory: WorkingMemory
): Promise<void> {
  const paths = getBrainPaths(workspaceRoot);
  await fsWriteFile(paths.workingMemoryFile, `${JSON.stringify(workingMemory, null, 2)}\n`, "utf8");
  setCachedWorkingMemory(workspaceRoot, workingMemory);
}

export async function getCachedMemoryGraph(workspaceRoot: string): Promise<{
  edges: MemoryGraphEdge[];
  nodes: MemoryGraphNode[];
}> {
  const cache = getCacheEntry(workspaceRoot);
  const nodesPromise = cache.graphNodes ?? loadMemoryGraphNodes(workspaceRoot);
  const edgesPromise = cache.graphEdges ?? loadMemoryGraphEdges(workspaceRoot);
  cache.graphNodes = nodesPromise;
  cache.graphEdges = edgesPromise;
  const [nodes, edges] = await Promise.all([nodesPromise, edgesPromise]);
  cache.graphNodes = nodes;
  cache.graphEdges = edges;

  return {
    edges,
    nodes,
  };
}

export function setCachedMemoryGraph(
  workspaceRoot: string,
  graph: {
    edges: MemoryGraphEdge[];
    nodes: MemoryGraphNode[];
  }
): void {
  const cache = getCacheEntry(workspaceRoot);
  cache.graphEdges = graph.edges;
  cache.graphNodes = graph.nodes;
}

export async function getCachedFileImportance(workspaceRoot: string): Promise<FileImportanceMap> {
  const cache = getCacheEntry(workspaceRoot);
  if (cache.fileImportance !== undefined) {
    return await cache.fileImportance;
  }

  const pending = loadFileImportance(workspaceRoot);
  cache.fileImportance = pending;
  const resolved = await pending;
  cache.fileImportance = resolved;
  return resolved;
}

export function setCachedFileImportance(
  workspaceRoot: string,
  fileImportance: FileImportanceMap
): void {
  getCacheEntry(workspaceRoot).fileImportance = fileImportance;
}

export async function writeCachedFileImportance(
  workspaceRoot: string,
  fileImportance: FileImportanceMap,
  serializedFileImportance: string
): Promise<void> {
  const paths = getBrainPaths(workspaceRoot);
  await fsWriteFile(paths.fileImportanceFile, serializedFileImportance, "utf8");
  setCachedFileImportance(workspaceRoot, fileImportance);
}

export function clearBrainStateCache(workspaceRoot?: string): void {
  if (workspaceRoot) {
    brainStateCacheByWorkspace.delete(workspaceRoot);
    return;
  }

  brainStateCacheByWorkspace.clear();
}
