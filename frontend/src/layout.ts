import type { LayoutBlock } from "./types";

export const CONTAINER_KINDS = new Set(["stack", "section", "columns"]);

export function isContainer(block: LayoutBlock): boolean {
  return CONTAINER_KINDS.has(block.kind);
}

export function findBlock(root: LayoutBlock, id: string): LayoutBlock | null {
  if (root.id === id) return root;
  for (const child of root.children) {
    const match = findBlock(child, id);
    if (match) return match;
  }
  return null;
}

export function updateBlock(root: LayoutBlock, id: string, updater: (block: LayoutBlock) => LayoutBlock): LayoutBlock {
  if (root.id === id) return updater(root);
  return { ...root, children: root.children.map((child) => updateBlock(child, id, updater)) };
}

export function removeBlock(root: LayoutBlock, id: string): LayoutBlock {
  return {
    ...root,
    children: root.children.filter((child) => child.id !== id).map((child) => removeBlock(child, id)),
  };
}

export function insertBefore(root: LayoutBlock, targetId: string, block: LayoutBlock): LayoutBlock {
  if (root.id === targetId) return root;
  const directIndex = root.children.findIndex((child) => child.id === targetId);
  if (directIndex >= 0) {
    const next = [...root.children];
    next.splice(directIndex, 0, block);
    return { ...root, children: next };
  }
  return { ...root, children: root.children.map((child) => insertBefore(child, targetId, block)) };
}

export function appendToContainer(root: LayoutBlock, containerId: string, block: LayoutBlock): LayoutBlock {
  if (root.id === containerId) return { ...root, children: [...root.children, block] };
  return { ...root, children: root.children.map((child) => appendToContainer(child, containerId, block)) };
}

export function containsBlock(root: LayoutBlock, id: string): boolean {
  return findBlock(root, id) !== null;
}

export function parentOf(root: LayoutBlock, id: string): LayoutBlock | null {
  if (root.children.some((child) => child.id === id)) return root;
  for (const child of root.children) {
    const parent = parentOf(child, id);
    if (parent) return parent;
  }
  return null;
}

export function blockDepth(root: LayoutBlock, id: string, depth = 0): number {
  if (root.id === id) return depth;
  for (const child of root.children) {
    const found = blockDepth(child, id, depth + 1);
    if (found >= 0) return found;
  }
  return -1;
}

export function updateFieldReferences(root: LayoutBlock, fieldId: string, updater: (block: LayoutBlock) => LayoutBlock): LayoutBlock {
  const next = root.fieldId === fieldId ? updater(root) : root;
  return { ...next, children: next.children.map((child) => updateFieldReferences(child, fieldId, updater)) };
}

export function referencedFieldIds(root: LayoutBlock, out = new Set<string>()): Set<string> {
  if (root.fieldId) out.add(root.fieldId);
  for (const child of root.children) referencedFieldIds(child, out);
  return out;
}
