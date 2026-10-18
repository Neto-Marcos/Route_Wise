export function isValidStopReorder(
  existingStops: Array<{ id?: string }>,
  requestedStops: Array<{ id?: string }>
): boolean {
  const existingIds = new Set(existingStops.map((s) => s.id));
  return (
    existingStops.length === requestedStops.length &&
    !existingIds.has(undefined) &&
    existingIds.size === existingStops.length &&
    new Set(requestedStops.map((s) => s.id)).size === requestedStops.length &&
    requestedStops.every((s) => existingIds.has(s.id)) &&
    existingStops[0]?.id === requestedStops[0]?.id
  );
}
