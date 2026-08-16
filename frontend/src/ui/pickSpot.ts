/**
 * Post-run report location picker: shows the route just walked on a real map
 * and asks the player to click the exact spot they want to report.
 */
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { LevelSpec } from '../level/types';
import { MAP_STYLE } from './routeSelect';

export function pickSpotOnRoute(
  minimap: LevelSpec['minimap'],
): Promise<[number, number] | null> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.style.cssText =
      'position:fixed;inset:0;z-index:25;background:#1a1a2e;display:flex;flex-direction:column;';
    root.innerHTML = `
      <div style="padding:10px 14px;display:flex;align-items:center;gap:12px;color:#e8e3d0;
                  font-family:sans-serif;background:#101020;">
        <strong style="color:#f4d35e;">📍 Where was it?</strong>
        <span style="flex:1;font-size:14px;">This is the route you walked — click the spot
          you want to report.</span>
        <button id="ps-cancel" style="padding:6px 12px;background:#2a2a45;color:#cfcfe0;border:0;
                border-radius:4px;cursor:pointer;">Cancel</button>
      </div>
      <div id="ps-map" style="flex:1;"></div>`;
    document.body.appendChild(root);

    const map = new maplibregl.Map({
      container: root.querySelector<HTMLElement>('#ps-map')!,
      style: MAP_STYLE,
      center: minimap.polyline[0] ?? [72.837, 19.055],
      zoom: 15,
      doubleClickZoom: false,
      clickTolerance: 10,
    });

    if (import.meta.env.DEV) {
      (window as unknown as { __pickMap: maplibregl.Map }).__pickMap = map;
    }

    if (minimap.polyline.length > 1) {
      const bounds = minimap.polyline.reduce(
        (b, coord) => b.extend(coord),
        new maplibregl.LngLatBounds(minimap.polyline[0], minimap.polyline[0]),
      );
      map.fitBounds(bounds, { padding: 60, maxZoom: 17, duration: 0 });
      map.on('load', () => {
        map.addSource('walked-route', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: minimap.polyline },
          },
        });
        // Purple over white casing — OSM's raster style paints major roads
        // yellow, so anything yellow-ish vanishes into them.
        map.addLayer({
          id: 'walked-route-casing',
          type: 'line',
          source: 'walked-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.9 },
        });
        map.addLayer({
          id: 'walked-route',
          type: 'line',
          source: 'walked-route',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': '#7c4dff', 'line-width': 4.5, 'line-opacity': 0.95 },
        });
        new maplibregl.Marker({ color: '#2a7a2a' }).setLngLat(minimap.polyline[0]).addTo(map);
        new maplibregl.Marker({ color: '#c0392b' })
          .setLngLat(minimap.polyline[minimap.polyline.length - 1])
          .addTo(map);
      });
    }

    const cleanup = (result: [number, number] | null) => {
      map.remove();
      root.remove();
      resolve(result);
    };
    root.querySelector('#ps-cancel')!.addEventListener('click', () => cleanup(null));
    map.on('click', (e: maplibregl.MapMouseEvent) => {
      cleanup([e.lngLat.lng, e.lngLat.lat]);
    });
  });
}
