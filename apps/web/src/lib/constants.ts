export const SDK_WIRE_VERSION = 'v1';
export const APP_NAME = 'Glassfish Zero';

export const RANGE_PRESETS = [
  { id: '1h', label: 'Last hour', ms: 60 * 60 * 1000 },
  { id: '24h', label: 'Last 24 hours', ms: 24 * 60 * 60 * 1000 },
  { id: '7d', label: 'Last 7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { id: '30d', label: 'Last 30 days', ms: 30 * 24 * 60 * 60 * 1000 },
  { id: '90d', label: 'Last 90 days', ms: 90 * 24 * 60 * 60 * 1000 },
] as const;

export type RangeId = (typeof RANGE_PRESETS)[number]['id'];

export function resolveRange(id: string | undefined): { id: RangeId; label: string; since: number } {
  const preset = RANGE_PRESETS.find((r) => r.id === id) ?? RANGE_PRESETS[2];
  return { id: preset.id, label: preset.label, since: Date.now() - preset.ms };
}
