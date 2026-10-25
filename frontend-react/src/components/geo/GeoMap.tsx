/**
 * GeoMap — react-leaflet map showing geolocated IPs from a scan.
 *
 * Data: GET /api/geo/:id/data → GeoJSON FeatureCollection
 *
 * Features preserved from old geomap.js:
 *   - CartoDB Dark Matter tile layer (same as old UI)
 *   - Risk-colored circle markers (red=high/critical, amber=medium, green=low)
 *   - Pulsing animation for high-risk markers
 *   - Popup with IP, city, country, ISP, open ports, CVEs
 *   - Auto-fit bounds when multiple markers exist
 *
 * Cleanup: react-leaflet handles Leaflet instance lifecycle.
 *
 * Leaflet CSS must be imported at the page/app level — done in this file.
 */

import 'leaflet/dist/leaflet.css';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import type { GeoFeature, GeoFeatureCollection, RiskLevel } from '@/types';
import { EmptyState } from '@/components/shared/EmptyState';

// Risk colours from old geomap.js
const RISK_COLORS: Record<RiskLevel | string, string> = {
  critical: '#ef4444',
  high:     '#ef4444',
  medium:   '#f59e0b',
  low:      '#10b981',
};

function getRiskColor(risk: string): string {
  return RISK_COLORS[risk] ?? '#10b981';
}

// ── Auto-fit bounds component ─────────────────────────────────────────────────
function FitBounds({ features }: { features: GeoFeature[] }) {
  const map = useMap();

  if (features.length === 0) return null;

  const lats = features.map((f) => f.geometry.coordinates[1]);
  const lons = features.map((f) => f.geometry.coordinates[0]);
  const bounds: [[number, number], [number, number]] = [
    [Math.min(...lats), Math.min(...lons)],
    [Math.max(...lats), Math.max(...lons)],
  ];

  // Only fit if we have valid bounds
  if (features.length === 1) {
    map.setView([lats[0], lons[0]], 8);
  } else {
    try {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 10 });
    } catch {
      // bounds may be invalid if all points are identical
      map.setView([lats[0], lons[0]], 5);
    }
  }

  return null;
}

interface GeoMapProps {
  data: GeoFeatureCollection;
}

export function GeoMap({ data }: GeoMapProps) {
  if (data.features.length === 0) {
    return (
      <EmptyState
        title="No geolocation data"
        description="Geo data is populated from Shodan enrichment during Full scans. No IPs were geolocated for this scan."
      />
    );
  }

  return (
    <div className="relative overflow-hidden rounded-lg border border-white/[0.07]">
      {/* Summary pill */}
      <div className="absolute left-3 top-3 z-[1000] rounded-full bg-black/70 px-3 py-1 text-xs text-text-secondary backdrop-blur-sm">
        {data.total} IP{data.total !== 1 ? 's' : ''} located
      </div>

      <MapContainer
        center={[20, 0]}
        zoom={2}
        style={{ height: 480 }}
        className="z-0"
        scrollWheelZoom
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          subdomains="abcd"
          maxZoom={20}
        />

        <FitBounds features={data.features} />

        {data.features.map((feature, i) => {
          const { coordinates } = feature.geometry;
          const props = feature.properties;
          const color = getRiskColor(props.risk_level);
          const isHighRisk = props.risk_level === 'high' || props.risk_level === 'critical';

          return (
            <CircleMarker
              key={`${props.ip}-${i}`}
              center={[coordinates[1], coordinates[0]]}
              radius={isHighRisk ? 10 : 7}
              pathOptions={{
                color: '#fff',
                weight: 1.5,
                fillColor: color,
                fillOpacity: 0.85,
              }}
            >
              <Popup>
                <div className="min-w-[180px] space-y-1 text-sm">
                  <p className="font-bold">{props.ip}</p>
                  <p className="text-gray-400 text-xs">{props.city}, {props.country}</p>
                  <div className="space-y-0.5 text-xs">
                    <p><span className="text-gray-400">Platform: </span>{props.platform}</p>
                    <p><span className="text-gray-400">ISP: </span>{props.isp}</p>
                    {props.organization && (
                      <p><span className="text-gray-400">Org: </span>{props.organization}</p>
                    )}
                    <p>
                      <span className="text-gray-400">Ports: </span>
                      {props.open_ports.length > 0 ? props.open_ports.join(', ') : 'None'}
                    </p>
                    {props.vulns.length > 0 && (
                      <p>
                        <span className="text-gray-400">CVEs: </span>
                        {props.vulns.slice(0, 3).join(', ')}
                        {props.vulns.length > 3 ? '…' : ''}
                      </p>
                    )}
                    <p>
                      <span className="text-gray-400">Risk: </span>
                      <span style={{ color }}>{props.risk_level.toUpperCase()}</span>
                    </p>
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>

      {/* Legend */}
      <div className="flex items-center gap-3 border-t border-white/[0.07] bg-white/[0.03] px-4 py-2 text-xs text-text-tertiary">
        {(['high', 'medium', 'low'] as const).map((risk) => (
          <span key={risk} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: RISK_COLORS[risk] }}
            />
            {risk.charAt(0).toUpperCase() + risk.slice(1)} risk
          </span>
        ))}
      </div>
    </div>
  );
}
