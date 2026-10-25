// Geo Map Visualization Module using Leaflet.js

let geoMap = null;
let geoMarkers = [];

function initGeoMap() {
    if (geoMap) return;

    // Initialize map centered at arbitrary point, zoom 2
    geoMap = L.map('geoip-map').setView([20, 0], 2);

    // Use CartoDB Dark Matter tiles for a sleek UI
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(geoMap);
}

function clearMap() {
    geoMarkers.forEach(m => geoMap.removeLayer(m));
    geoMarkers = [];
}

function getMarkerColor(risk) {
    if (risk === 'critical' || risk === 'high') return '#ef4444'; // Red
    if (risk === 'medium') return '#f59e0b'; // Orange
    return '#10b981'; // Green
}

async function loadGeoData(scanId) {
    if (!scanId) return;

    try {
        const resp = await req(`/api/geo/${scanId}/data`);

        clearMap();

        if (resp.features && resp.features.length > 0) {
            const bounds = L.latLngBounds();

            resp.features.forEach(feature => {
                const props = feature.properties;
                const coords = [feature.geometry.coordinates[1], feature.geometry.coordinates[0]];

                // Create custom icon
                const color = getMarkerColor(props.risk_level);
                const isHighRisk = props.risk_level === 'high' || props.risk_level === 'critical';

                const iconHtml = `
                    <div style="background-color: ${color}; width: 16px; height: 16px; border-radius: 50%; box-shadow: 0 0 ${isHighRisk ? '12px' : '4px'} ${color}; border: 2px solid white; ${isHighRisk ? 'animation: pulse 2s infinite;' : ''}"></div>
                `;

                const icon = L.divIcon({
                    html: iconHtml,
                    className: 'custom-geo-marker',
                    iconSize: [16, 16],
                    iconAnchor: [8, 8]
                });

                const marker = L.marker(coords, { icon }).addTo(geoMap);

                // Popup content
                const ports = props.open_ports ? props.open_ports.join(', ') : 'None';
                const vulns = props.vulns ? `<br><b>CVEs:</b> ${props.vulns.slice(0, 3).join(', ')}${props.vulns.length > 3 ? '...' : ''}` : '';

                marker.bindPopup(`
                    <div class="geo-popup">
                        <strong>${props.ip}</strong><br>
                        ${props.city}, ${props.country}<br>
                        <b>ISP:</b> ${props.isp}<br>
                        <b>Ports:</b> ${ports}
                        ${vulns}
                    </div>
                `);

                geoMarkers.push(marker);
                bounds.extend(coords);
            });

            // Fit map to markers
            geoMap.fitBounds(bounds, { padding: [50, 50], maxZoom: 10 });
        } else {
            document.getElementById('geo-map-status').innerText = 'No geolocation data found for this scan.';
            document.getElementById('geo-map-status').style.display = 'block';
        }
    } catch (e) {
        console.error("Failed to load geo data", e);
        document.getElementById('geo-map-status').innerText = 'Error loading map data.';
        document.getElementById('geo-map-status').style.display = 'block';
    }
}

// Attach to global window
window.renderGeoMap = function(scanId) {
    document.getElementById('geo-map-status').style.display = 'none';

    // Need short timeout for Leaflet to measure container size properly when un-hidden
    setTimeout(() => {
        initGeoMap();
        loadGeoData(scanId);
    }, 100);
};
