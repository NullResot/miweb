export interface PageNode {
  id: string;
  sourceId?: string;
  parentId: string | null;
  tag: string;
  label: string;
  text: string;
  selector: string;
  file?: string;
  line?: number;
  mappingWarning?: string;
  baseTranslate: string;
  width: number;
  height: number;
  fontSize: number;
  borderRadius: number;
  display: string;
  rect: { x: number; y: number; width: number; height: number };
}
export interface Session {
  id: string;
  token: string;
  html: string;
  title: string;
  location: string;
  mode: "source" | "snapshot";
  nodes: PageNode[];
  width: number;
  height: number;
  warnings: string[];
  mappedCount: number;
}
export interface Change {
  id: string;
  x: number;
  y: number;
  width?: number | null;
  height?: number | null;
  fontSize?: number | null;
  borderRadius?: number | null;
}
export type Changes = Record<string, Change>;
export interface ExportResult {
  css: string;
  javascript?: string;
  diff: string;
  files: { path: string; original: string; updated: string; diff: string }[];
  mapped: number;
  total: number;
}
export const isChanged = (change: Change) =>
  !!(
    change.x ||
    change.y ||
    change.width != null ||
    change.height != null ||
    change.fontSize != null ||
    change.borderRadius != null
  );
