/**
 * TimelinePage — /timeline/:scanId
 * Chronological event timeline via D3.
 */
import { useQuery } from '@tanstack/react-query';
import { VisualizationPage } from '@/components/visualization/VisualizationPage';
import { TimelineChart } from '@/components/timeline/TimelineChart';
import { Card } from '@/components/shared/Card';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorState } from '@/components/shared/ErrorState';
import { timelineApi } from '@/api/visualizations';

function TimelineContent({ scanId }: { scanId: number }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['timeline', scanId] as const,
    queryFn: () => timelineApi.getTimelineEvents(scanId),
    staleTime: Infinity,
    retry: 1,
  });

  if (isLoading) {
    return (
      <Card>
        <div className="flex items-center justify-center gap-3 py-20">
          <LoadingSpinner size="lg" />
          <span className="text-sm text-text-tertiary">Loading timeline…</span>
        </div>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <ErrorState title="Failed to load timeline" error={error} onRetry={() => void refetch()} />
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card>
      <TimelineChart data={data} />
    </Card>
  );
}

export function TimelinePage() {
  return (
    <VisualizationPage title="Event Timeline">
      {(scanId) => <TimelineContent scanId={scanId} />}
    </VisualizationPage>
  );
}
