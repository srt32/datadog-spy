export interface DataPoint {
  timestamp: number;
  value: number;
}

interface SparklineOptions {
  width?: number;
  height?: number;
  lineColor?: string;
  fillColor?: string;
  labelColor?: string;
  backgroundColor?: string;
}

const DEFAULTS: Required<SparklineOptions> = {
  width: 300,
  height: 60,
  lineColor: '#632CA6',
  fillColor: 'rgba(99, 44, 166, 0.15)',
  labelColor: '#888888',
  backgroundColor: 'transparent',
};

/**
 * Renders an SVG sparkline from data points.
 */
export function renderSparkline(data: DataPoint[], options: SparklineOptions = {}): string {
  const opts = { ...DEFAULTS, ...options };
  const { width, height, lineColor, fillColor, labelColor, backgroundColor } = opts;

  if (data.length === 0) {
    return renderEmptyState(width, height, labelColor, backgroundColor);
  }

  const padding = { top: 8, right: 8, bottom: 16, left: 8 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const values = data.map(d => d.value);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  const avg = values.reduce((a, b) => a + b, 0) / values.length;

  // Build polyline points
  const points = data.map((d, i) => {
    const x = padding.left + (i / Math.max(data.length - 1, 1)) * chartWidth;
    const y = padding.top + chartHeight - ((d.value - minVal) / range) * chartHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  // Build filled area path
  const firstX = padding.left;
  const lastX = padding.left + chartWidth;
  const baseY = padding.top + chartHeight;
  const areaPoints = [`${firstX},${baseY}`, ...points, `${lastX},${baseY}`];

  // Time labels
  const startTime = data[0].timestamp;
  const endTime = data[data.length - 1].timestamp;
  const startLabel = formatTime(startTime);
  const endLabel = formatTime(endTime);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${backgroundColor}" rx="4"/>
  <polygon points="${areaPoints.join(' ')}" fill="${fillColor}"/>
  <polyline points="${points.join(' ')}" fill="none" stroke="${lineColor}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
  <text x="${padding.left}" y="${height - 2}" font-family="monospace" font-size="8" fill="${labelColor}">${startLabel}</text>
  <text x="${width - padding.right}" y="${height - 2}" font-family="monospace" font-size="8" fill="${labelColor}" text-anchor="end">${endLabel}</text>
</svg>`;
}

function renderEmptyState(width: number, height: number, labelColor: string, backgroundColor: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${backgroundColor}" rx="4"/>
  <text x="${width / 2}" y="${height / 2}" font-family="monospace" font-size="10" fill="${labelColor}" text-anchor="middle" dominant-baseline="middle">No data</text>
</svg>`;
}

function formatTime(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Computes summary statistics for a set of data points.
 */
export function computeStats(data: DataPoint[]): { avg: number; min: number; max: number; latest: number } {
  if (data.length === 0) {
    return { avg: 0, min: 0, max: 0, latest: 0 };
  }
  const values = data.map(d => d.value);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    avg,
    min: Math.min(...values),
    max: Math.max(...values),
    latest: values[values.length - 1],
  };
}

/**
 * Formats a number for display (compact notation).
 */
export function formatNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000) {
    return (n / 1_000_000).toFixed(1) + 'M';
  }
  if (Math.abs(n) >= 1_000) {
    return (n / 1_000).toFixed(1) + 'K';
  }
  if (Number.isInteger(n)) {
    return n.toString();
  }
  return n.toFixed(2);
}

/**
 * Converts an SVG string to a base64 data URI.
 */
export function svgToDataUri(svg: string): string {
  const encoded = Buffer.from(svg).toString('base64');
  return `data:image/svg+xml;base64,${encoded}`;
}
