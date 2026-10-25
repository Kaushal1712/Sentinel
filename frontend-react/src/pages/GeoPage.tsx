/**
 * GeoPage — /geomap/:scanId
 * Geo IP map via react-leaflet.
 */
import { useQuery } from '@tanstack/react-query';
import { VisualizationPage } from '@/components/visualization/VisualizationPage';
import { GeoMap } from '@/components/geo/GeoMap';
import { Card } from '@/components/shared/Card';
import { LoadingSpinner } from '@/components/shared/LoadingSpinner';
import { ErrorState } from '@/components/shared/ErrorState';
import { geoApi } from '@/api/visualizations';

function GeoContent({ scanId }: { scanId: number }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['geo', scanId] as const,
    queryFn: () => geoApi.getGeoData(scanId),
    staleTime: Infinity,
    retry: 1,
  });

  if (isLoading) {
    return (
      <Card>
        <div className="flex items-center justify-center gap-3 py-20">
          <LoadingSpinner size="lg" />
          <span className="text-sm text-text-tertiary">Loading geo data…</span>
        </div>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <ErrorState title="Failed to load geo data" error={error} onRetry={() => void refetch()} />
      </Card>
    );
  }

  if (!data) return null;

  return <GeoMap data={data} />;
}

export function GeoPage() {
  return (
    <VisualizationPage title="Geographic Map">
      {(scanId) => <GeoContent scanId={scanId} />}
    </VisualizationPage>
  );
}
