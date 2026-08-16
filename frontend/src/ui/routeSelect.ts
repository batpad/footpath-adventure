/**
 * Fullscreen DOM overlay with a real map of Bandra West: click origin, click
 * destination, get a level generated from those actual streets.
 */
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { LevelSpec, Mode } from '../level/types';
import { ApiError, createLevel, fetchArea } from '../net/api';
import { openReportForm } from './reportForm';

const MAP_STYLE: maplibregl.MapOptions['style'] = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

export function pickRoute(mode: Mode): Promise<LevelSpec | null> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.style.cssText =
      'position:fixed;inset:0;z-index:20;background:#1a1a2e;display:flex;flex-direction:column;';
    root.innerHTML = `
      <div style="padding:10px 14px;display:flex;align-items:center;gap:12px;color:#e8e3d0;
                  font-family:sans-serif;background:#101020;">
        <strong style="color:#f4d35e;">Pick your route</strong>
        <span id="rs-status" style="flex:1;font-size:14px;">Click your starting point…</span>
        <button id="rs-report" style="padding:6px 12px;background:#2a5a3a;color:#e8e3d0;border:0;
                border-radius:4px;cursor:pointer;">📸 Report a spot</button>
        <button id="rs-reset" style="padding:6px 12px;background:#2a2a45;color:#cfcfe0;border:0;
                border-radius:4px;cursor:pointer;">Reset</button>
        <button id="rs-cancel" style="padding:6px 12px;background:#2a2a45;color:#cfcfe0;border:0;
                border-radius:4px;cursor:pointer;">Cancel</button>
      </div>
      <div id="rs-map" style="flex:1;position:relative;">
        <div id="rs-legend" style="position:absolute;bottom:24px;left:10px;z-index:5;display:none;
             background:#101020dd;color:#cfcfe0;font-size:12px;padding:8px 10px;border-radius:6px;
             line-height:1.7;">
          <strong style="color:#f4d35e;">Reported conditions</strong><br>
          <span style="color:#e05545;">▬▬</span> footpath problems reported<br>
          <span style="color:#4caf50;">▬▬</span> reported as good
        </div>
      </div>`;
    document.body.appendChild(root);

    const status = root.querySelector<HTMLElement>('#rs-status')!;
    const markers: maplibregl.Marker[] = [];
    let origin: [number, number] | null = null;
    let busy = false;

    const map = new maplibregl.Map({
      container: root.querySelector<HTMLElement>('#rs-map')!,
      style: MAP_STYLE,
      center: [72.837, 19.055],
      zoom: 14.5,
      // Two quick clicks (origin → destination) must never read as a
      // double-click zoom, and a slightly shaky click is still a click.
      doubleClickZoom: false,
      clickTolerance: 10,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    // Crowdsourced condition heatmap: streets people have reported on.
    map.on('load', async () => {
      try {
        const res = await fetch('/api/segments/');
        if (!res.ok) return;
        const geojson = await res.json();
        if (!geojson.features?.length) return;
        map.addSource('conditions', { type: 'geojson', data: geojson });
        map.addLayer({
          id: 'conditions',
          type: 'line',
          source: 'conditions',
          layout: { 'line-cap': 'round' },
          paint: {
            'line-width': 6,
            'line-opacity': 0.75,
            'line-color': [
              'case',
              ['>', ['get', 'bad'], ['get', 'good']],
              [
                'interpolate',
                ['linear'],
                ['get', 'bad'],
                0.5,
                '#e0a030',
                3,
                '#e05545',
                8,
                '#b3362b',
              ],
              '#4caf50',
            ],
          },
        });
        root.querySelector<HTMLElement>('#rs-legend')!.style.display = 'block';

        const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
        map.on('mousemove', 'conditions', (e: maplibregl.MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as { name: string; bad: number; good: number; worst: string };
          const label =
            p.bad > p.good
              ? `⚠ ${p.worst || 'problems'} reported`
              : '👍 reported as good';
          popup
            .setLngLat(e.lngLat)
            .setHTML(
              `<div style="font-family:sans-serif;font-size:12px;color:#1a1a2e;">
                 <strong>${p.name}</strong><br>${label}</div>`,
            )
            .addTo(map);
        });
        map.on('mouseleave', 'conditions', () => popup.remove());
      } catch {
        // Heatmap is decorative — never block route picking on it.
      }
    });

    fetchArea()
      .then((area) => {
        map.fitBounds(
          [
            [area.bbox[0], area.bbox[1]],
            [area.bbox[2], area.bbox[3]],
          ],
          { padding: 30, duration: 0, maxZoom: 15.5 },
        );
      })
      .catch(() => {
        status.textContent = '⚠ Backend not reachable — is the Django server running?';
      });

    const cleanup = (result: LevelSpec | null) => {
      map.remove();
      root.remove();
      resolve(result);
    };

    const reset = () => {
      for (const m of markers) m.remove();
      markers.length = 0;
      origin = null;
      busy = false;
      status.textContent = 'Click your starting point…';
    };

    root.querySelector('#rs-cancel')!.addEventListener('click', () => cleanup(null));
    root.querySelector('#rs-reset')!.addEventListener('click', reset);

    let reportMode = false;
    const reportBtn = root.querySelector<HTMLButtonElement>('#rs-report')!;
    reportBtn.addEventListener('click', () => {
      reportMode = !reportMode;
      reportBtn.style.background = reportMode ? '#f4d35e' : '#2a5a3a';
      reportBtn.style.color = reportMode ? '#1a1a2e' : '#e8e3d0';
      status.textContent = reportMode
        ? 'Report mode: click the exact spot on the map…'
        : 'Click your starting point…';
    });

    map.on('click', async (e: maplibregl.MapMouseEvent) => {
      if (busy) return;
      if (reportMode) {
        const pin = new maplibregl.Marker({ color: '#f4d35e' })
          .setLngLat(e.lngLat)
          .addTo(map);
        await openReportForm({ lngLat: [e.lngLat.lng, e.lngLat.lat] });
        pin.remove();
        return;
      }
      const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
      markers.push(
        new maplibregl.Marker({ color: origin ? '#c0392b' : '#2a7a2a' })
          .setLngLat(lngLat)
          .addTo(map),
      );
      if (!origin) {
        origin = lngLat;
        status.textContent = 'Now click your destination…';
        return;
      }
      busy = true;
      status.textContent = '⏳ Building your commute from real street data…';
      try {
        const spec = await createLevel(origin, lngLat, mode);
        cleanup(spec);
      } catch (err) {
        // Keep the origin so one bad destination click doesn't restart the
        // whole selection — just drop the failed destination marker.
        markers.pop()?.remove();
        busy = false;
        status.textContent = `⚠ ${err instanceof ApiError ? err.message : 'Something went wrong.'} Pick a different destination…`;
      }
    });
  });
}
