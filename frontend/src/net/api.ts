import type { LevelSpec, Mode } from '../level/types';

export interface AreaInfo {
  bbox: [number, number, number, number];
  center: [number, number];
  name: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(body.detail ?? `Request failed (${res.status})`, res.status);
  }
  return body as T;
}

export async function fetchArea(): Promise<AreaInfo> {
  return handle(await fetch('/api/area/'));
}

export interface ReportResult {
  id: number;
  status: string;
  street: string;
  near: string;
}

function submitterId(): string {
  let id = localStorage.getItem('fa-submitter');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('fa-submitter', id);
  }
  return id;
}

export async function submitReport(
  fields: Record<string, string>,
  photo?: File,
): Promise<ReportResult> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('submitter_id', submitterId());
  if (photo) form.append('photo', photo);
  return handle(await fetch('/api/reports/', { method: 'POST', body: form }));
}

export async function createLevel(
  origin: [number, number],
  destination: [number, number],
  mode: Mode,
): Promise<LevelSpec> {
  return handle(
    await fetch('/api/levels/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin, destination, mode }),
    }),
  );
}
