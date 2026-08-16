/**
 * DOM overlay for submitting a footpath condition report — from in-game
 * (level_token + route distance) or from a map pin (lng/lat).
 */
import { ApiError, submitReport } from '../net/api';

export interface ReportContext {
  levelToken?: string;
  distanceM?: number;
  lane?: string;
  lngLat?: [number, number];
  placeHint?: string;
}

const CATEGORIES: [string, string, string][] = [
  ['blocked_hawker', '⛱️', 'Hawkers'],
  ['blocked_parked_vehicle', '🛵', 'Parked vehicles'],
  ['broken_surface', '🧱', 'Broken surface'],
  ['open_drain', '🕳️', 'Open drain'],
  ['no_kerb_ramp', '♿', 'No kerb ramp'],
  ['dead_end', '🚫', 'Dead end'],
  ['construction', '🚧', 'Construction'],
  ['waterlogging', '🌊', 'Waterlogging'],
  ['encroachment', '📦', 'Encroachment'],
  ['obstacle_pole', '🚏', 'Pole in the way'],
  ['narrow', '↔️', 'Too narrow'],
  ['good', '👍', 'Actually good!'],
];

/** Resolves true if a report was submitted, false on cancel. */
export function openReportForm(ctx: ReportContext): Promise<boolean> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.style.cssText =
      'position:fixed;inset:0;z-index:30;background:#000a;display:flex;' +
      'align-items:center;justify-content:center;font-family:sans-serif;';
    root.innerHTML = `
      <div style="background:#1e1e33;border-radius:12px;max-width:420px;width:92%;
                  max-height:92vh;overflow:auto;padding:18px;color:#e8e3d0;">
        <h2 style="margin:0 0 4px;color:#f4d35e;font-size:20px;">📸 Report this footpath</h2>
        <p style="margin:0 0 12px;font-size:13px;color:#9a9ab5;">
          ${ctx.placeHint ? `Near ${ctx.placeHint} — a` : 'A'}nonymous; a moderator reviews it,
          then the street changes in-game for everyone.
        </p>
        <div id="rf-cats" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;"></div>
        <div style="margin:12px 0 4px;font-size:13px;color:#9a9ab5;">How bad?</div>
        <div id="rf-sev" style="display:flex;gap:6px;"></div>
        <textarea id="rf-note" placeholder="Anything else? (optional)" maxlength="500"
          style="width:100%;box-sizing:border-box;margin-top:12px;background:#14142a;color:#e8e3d0;
                 border:1px solid #33334d;border-radius:6px;padding:8px;min-height:56px;"></textarea>
        <label style="display:block;margin-top:10px;font-size:13px;color:#9a9ab5;">
          Photo (optional)
          <input id="rf-photo" type="file" accept="image/*" capture="environment"
                 style="display:block;margin-top:4px;color:#9a9ab5;font-size:12px;">
        </label>
        <div id="rf-error" style="color:#e07060;font-size:13px;margin-top:8px;min-height:16px;"></div>
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button id="rf-submit" style="flex:1;padding:12px;background:#f4d35e;color:#1a1a2e;
                  border:0;border-radius:8px;font-size:16px;font-weight:bold;cursor:pointer;">
            Submit report</button>
          <button id="rf-cancel" style="padding:12px 16px;background:#2a2a45;color:#cfcfe0;
                  border:0;border-radius:8px;font-size:15px;cursor:pointer;">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(root);

    let category = '';
    let severity = '2';

    const catBox = root.querySelector('#rf-cats')!;
    const catButtons: HTMLButtonElement[] = [];
    for (const [key, emoji, label] of CATEGORIES) {
      const btn = document.createElement('button');
      btn.style.cssText =
        'padding:8px 4px;background:#14142a;color:#cfcfe0;border:1px solid #33334d;' +
        'border-radius:8px;cursor:pointer;font-size:12px;line-height:1.3;';
      btn.innerHTML = `<div style="font-size:20px">${emoji}</div>${label}`;
      btn.addEventListener('click', () => {
        category = key;
        for (const b of catButtons) b.style.borderColor = '#33334d';
        btn.style.borderColor = '#f4d35e';
      });
      catButtons.push(btn);
      catBox.appendChild(btn);
    }

    const sevBox = root.querySelector('#rf-sev')!;
    const sevButtons: HTMLButtonElement[] = [];
    [
      ['1', 'Annoying'],
      ['2', 'Bad'],
      ['3', 'Dangerous'],
    ].forEach(([value, label]) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText =
        'flex:1;padding:8px;background:#14142a;color:#cfcfe0;border:1px solid #33334d;' +
        'border-radius:8px;cursor:pointer;font-size:13px;';
      if (value === severity) btn.style.borderColor = '#f4d35e';
      btn.addEventListener('click', () => {
        severity = value;
        for (const b of sevButtons) b.style.borderColor = '#33334d';
        btn.style.borderColor = '#f4d35e';
      });
      sevButtons.push(btn);
      sevBox.appendChild(btn);
    });

    const errorBox = root.querySelector<HTMLElement>('#rf-error')!;
    const close = (submitted: boolean) => {
      root.remove();
      resolve(submitted);
    };
    root.querySelector('#rf-cancel')!.addEventListener('click', () => close(false));

    root.querySelector('#rf-submit')!.addEventListener('click', async () => {
      if (!category) {
        errorBox.textContent = 'Pick what you saw first.';
        return;
      }
      errorBox.textContent = '';
      const fields: Record<string, string> = {
        category,
        severity,
        note: root.querySelector<HTMLTextAreaElement>('#rf-note')!.value,
      };
      if (ctx.levelToken !== undefined) {
        fields.level_token = ctx.levelToken;
        fields.distance_m = String(ctx.distanceM ?? 0);
        fields.lane = ctx.lane ?? 'footpath';
      } else if (ctx.lngLat) {
        fields.lng = String(ctx.lngLat[0]);
        fields.lat = String(ctx.lngLat[1]);
      }
      const photo = root.querySelector<HTMLInputElement>('#rf-photo')!.files?.[0];
      try {
        const result = await submitReport(fields, photo);
        const where = result.near ? ` near ${result.near}` : '';
        errorBox.style.color = '#8fd18f';
        errorBox.textContent = `✓ Reported${where} — thank you! A moderator will review it.`;
        setTimeout(() => close(true), 1400);
      } catch (err) {
        errorBox.style.color = '#e07060';
        errorBox.textContent =
          err instanceof ApiError ? err.message : 'Could not submit — is the backend running?';
      }
    });
  });
}
