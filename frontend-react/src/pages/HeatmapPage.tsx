/**
 * HeatmapPage — /heatmap/:scanId
 * Adjacency matrix heatmap via D3.
 */
import { useQuery } from '@tanstack/react-query';
import { VisualizationPage } from '@/components/visualization/VisualizationPage';
import { HeatmapChart } from '@/components/heatmap/HeatmapChart';
import { Card } from '@/components/shared/Card';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorState } from '@/components/shared/ErrorState';
import { heatmapApi } from '@/api/visualizations';

function HeatmapContent({ scanId }: { scanId: number }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['heatmap', scanId] as const,
    queryFn: () => heatmapApi.getHeatmapMatrix(scanId),
    staleTime: Infinity,
    retry: 1,
  });

  if (isLoading) {
    return (
      <Card>
        <div className="flex items-center justify-center gap-3 py-20">
          <LoadingSpinner size="lg" />
          <span className="text-sm text-text-tertiary">Loading heatmap…</span>
        </div>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <ErrorState title="Failed to load heatmap" error={error} onRetry={() => void refetch()} />
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card>
      <HeatmapChart data={data} />
    </Card>
  );
}

export function HeatmapPage() {
  return (
    <VisualizationPage title="Identity Adjacency Heatmap">
      {(scanId) => <HeatmapContent scanId={scanId} />}
    </VisualizationPage>
  );
}
