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
    const parsed = JSON.parse(text);

    // The Datadog metrics API returns series data
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
