import type { Workspace } from "./schema";

export const WATERMARK_POSITIONS = [
  "center",
  "top_left",
  "top_right",
  "bottom_left",
  "bottom_right",
] as const;

export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

export type WorkspaceBranding = {
  logoFileId: string | null;
  logoBucketId: string | null;
  logoFileName: string | null;
  wmEnabled: boolean;
  wmPosition: WatermarkPosition;
  wmOpacity: number;
  wmScale: number;
};

export const DEFAULT_WORKSPACE_BRANDING: WorkspaceBranding = {
  logoFileId: null,
  logoBucketId: null,
  logoFileName: null,
  wmEnabled: false,
  wmPosition: "center",
  wmOpacity: 0.16,
  wmScale: 32,
};

export const MAX_BRANDING_FILE_SIZE_BYTES = 2 * 1024 * 1024;
export const ALLOWED_BRANDING_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export function clampWatermarkOpacity(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_WORKSPACE_BRANDING.wmOpacity;
  return Math.min(0.95, Math.max(0.05, Number(value)));
}

export function clampWatermarkScale(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_WORKSPACE_BRANDING.wmScale;
  return Math.min(80, Math.max(10, Math.round(Number(value))));
}

export function normalizeWatermarkPosition(value?: string | null): WatermarkPosition {
  if (value && WATERMARK_POSITIONS.includes(value as WatermarkPosition)) {
    return value as WatermarkPosition;
  }
  return DEFAULT_WORKSPACE_BRANDING.wmPosition;
}

export function normalizeWorkspaceBranding(
  workspace?: Workspace | null
): WorkspaceBranding {
  if (!workspace) {
    return { ...DEFAULT_WORKSPACE_BRANDING };
  }

  return {
    logoFileId: workspace.logoFileId?.trim() || null,
    logoBucketId: workspace.logoBucketId?.trim() || null,
    logoFileName: workspace.logoFileName?.trim() || null,
    wmEnabled: Boolean(workspace.wmEnabled),
    wmPosition: normalizeWatermarkPosition(workspace.wmPosition),
    wmOpacity: clampWatermarkOpacity(Number(workspace.wmOpacity ?? DEFAULT_WORKSPACE_BRANDING.wmOpacity)),
    wmScale: clampWatermarkScale(Number(workspace.wmScale ?? DEFAULT_WORKSPACE_BRANDING.wmScale)),
  };
}
