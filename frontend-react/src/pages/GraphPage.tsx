/**
 * GraphPage — /graph/:scanId
 * Identity network graph via Cytoscape.js.
 */
import { useQuery } from '@tanstack/react-query';
import { VisualizationPage } from '@/components/visualization/VisualizationPage';
import { IdentityGraph } from '@/components/graph/IdentityGraph';
import { Card } from '@/components/shared/Card';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorState } from '@/components/shared/ErrorState';
import { graphApi } from '@/api/visualizations';

function GraphContent({ scanId }: { scanId: number }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['graph', scanId] as const,
    queryFn: () => graphApi.getGraph(scanId),
    staleTime: Infinity,
    retry: 1,
  });

  if (isLoading) {
    return (
      <Card>
        <div className="flex items-center justify-center gap-3 py-20">
          <LoadingSpinner size="lg" />
          <span className="text-sm text-text-tertiary">Loading identity graph…</span>
        </div>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <ErrorState title="Failed to load graph" error={error} onRetry={() => void refetch()} />
      </Card>
    );
  }

  if (!data) return null;

  return <IdentityGraph graph={data.graph} scanId={scanId} />;
}

export function GraphPage() {
  return (
    <VisualizationPage title="Identity Graph">
      {(scanId) => <GraphContent scanId={scanId} />}
    </VisualizationPage>
  );
}
