import { DataPoint } from './graphRenderer';

/**
 * Parses the MCP tool response into DataPoint[].
 * Handles multiple response formats from different MCP servers.
 */
export function parseMetricsResponse(result: unknown): DataPoint[] {
  try {
    const res = result as { content?: Array<{ type: string; text: string }> };
    if (!res.content || res.content.length === 0) {
      return [];
    }

    const text = res.content[0].text;

    // Strip XML-style wrappers (e.g., <METADATA>...</METADATA>, <JSON_DATA>...</JSON_DATA>)
    let jsonText = text;
    const jsonDataMatch = text.match(/<JSON_DATA>\s*([\s\S]*?)\s*<\/JSON_DATA>/);
    if (jsonDataMatch) {
      jsonText = jsonDataMatch[1];
    }

    const parsed = JSON.parse(jsonText);

    // Official Datadog MCP: binned format with overall_stats
    // Shape: [{ expression, binned: [{ start_time, avg, min, max, count }], overall_stats }]
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].binned) {
      return parsed[0].binned.map((bin: { start_time: string; avg: number }) => ({
        timestamp: new Date(bin.start_time).getTime() / 1000,
        value: bin.avg || 0,
      }));
    }

    // Official Datadog MCP: CSV format with start_time and interval_ms
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].csv) {
      const entry = parsed[0];
      const startMs = new Date(entry.start_time || 0).getTime();
      const intervalMs = entry.interval_ms || 60000;
      return entry.csv.split(',').map((val: string, i: number) => ({
        timestamp: (startMs + i * intervalMs) / 1000,
        value: parseFloat(val) || 0,
      }));
    }

    // The Datadog metrics API returns series data (community server format)
    if (parsed.series && Array.isArray(parsed.series) && parsed.series.length > 0) {
      const series = parsed.series[0];
      const pointlist = series.pointlist || series.point_list || [];
      return pointlist.map((point: [number, number] | { timestamp: number; value: number }) => {
        if (Array.isArray(point)) {
          return { timestamp: point[0] / 1000, value: point[1] || 0 };
        }
        return { timestamp: point.timestamp, value: point.value || 0 };
      });
    }

    // Fallback: try to find data points directly
    if (Array.isArray(parsed)) {
      return parsed.map((p: { timestamp: number; value: number }) => ({
        timestamp: p.timestamp,
        value: p.value || 0,
      }));
    }

    return [];
  } catch {
    return [];
  }
}
