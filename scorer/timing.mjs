// Elapsed times use the largest suitable unit. Rates always use milliseconds per source line.
const significant = new Intl.NumberFormat('en-US', {
  minimumSignificantDigits: 3, maximumSignificantDigits: 3, useGrouping: false,
});
const units = [[86_400_000, 'd'], [3_600_000, 'h'], [60_000, 'min'], [1000, 's'], [1, 'ms'], [0.001, 'µs'], [0.000001, 'ns']];

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'not timed';
  if (ms === 0) return '0.00 ms';
  // Round before selecting a unit so 999.9 ms displays as 1.00 s.
  let index = units.findIndex(([scale]) => ms >= scale);
  if (index < 0) index = units.length - 1;
  const base = units[index][0];
  if (index > 0 && Number(significant.format(ms / base)) >= units[index - 1][0] / base) index--;
  const [scale, unit] = units[index];
  return `${significant.format(ms / scale)} ${unit}`;
}

export function formatTiming(layer) {
  const elapsed = formatDuration(layer.ms);
  return Number.isFinite(layer.msPerLoc) ? `${elapsed} (${significant.format(layer.msPerLoc)} ms/LOC)` : elapsed;
}

export function speedDetail(layers = {}) {
  return ['rules', 'journeys'].filter(key => Number.isFinite(layers[key]?.msPerLoc) && Number.isFinite(layers[key]?.ms))
    .map(key => {
      const layer = layers[key];
      return `${key === 'rules' ? 'Rules' : 'Journeys'} ${formatTiming(layer)}${layer.passed === false ? ', FAILED' : ''}`;
    }).join('; ');
}
