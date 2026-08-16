/**
 * LevelSpec is the contract between the backend level generator and the game.
 * In M1 it is fed from a hand-written sample level; from M3 it comes from
 * POST /api/levels/. Keep in sync with backend/apps/levels/serializers.py.
 */

export type Mode = 'dry' | 'monsoon';

export type FootpathSide = 'left' | 'right';

/** Lane a hazard occupies within a segment. */
export type HazardLane = 'footpath' | 'road_1' | 'road_2' | 'road_3';

export type HazardType =
  | 'hawker_stall'
  | 'parked_scooter'
  | 'broken_slab'
  | 'open_drain'
  | 'barrier'
  | 'dead_end'
  | 'construction'
  | 'pole';

/**
 * Persona-typed properties. The MVP walker only reacts to a few of these,
 * but every hazard carries them so wheelchair/elderly/pram personas can be
 * added without a schema change.
 */
export interface HazardProps {
  passable_gap_m?: number;
  step_height_m?: number;
  fall_damage?: boolean;
  forced_exit?: 'road';
  blocks?: string[];
}

export interface Hazard {
  type: HazardType;
  lane: HazardLane;
  /** Distance from segment start, metres. */
  at_m: number;
  span_m?: number;
  props?: HazardProps;
}

export interface Puddle {
  lane: HazardLane;
  at_m: number;
  span_m: number;
  splash: boolean;
}

export interface SegmentMonsoon {
  puddles: Puddle[];
  waterlogged: boolean;
}

export interface Crossing {
  type: 'signals' | 'zebra' | 'unmarked';
  kerb?: 'lowered' | 'raised' | 'flush';
  signal: boolean;
}

export interface SegmentFootpath {
  present: boolean;
  side: FootpathSide;
  width_class: 'narrow' | 'normal' | 'wide';
  confidence: number;
}

export interface SegmentPoi {
  name: string;
  /** OSM-ish category, e.g. "restaurant", "shop:clothes", "historic:monument". */
  category: string;
  at_m: number;
  side: FootpathSide;
}

export interface VehicleMix {
  car: number;
  rickshaw: number;
  bus: number;
  bike: number;
}

export interface LevelSegment {
  key: string;
  name?: string;
  length_m: number;
  road_class: string;
  /** 0..1, drives vehicle spawn rate. */
  traffic_density: number;
  vehicle_mix: VehicleMix;
  footpath: SegmentFootpath;
  /** Real-world turn after this segment, degrees (negative = left). Minimap only. */
  bend_after_deg?: number;
  hazards: Hazard[];
  monsoon?: SegmentMonsoon;
  crossing_after?: Crossing;
  /** Real named places along this street, for world flavour. */
  pois?: SegmentPoi[];
}

export interface LevelSpec {
  level_token: string;
  seed: number;
  mode: Mode;
  total_length_m: number;
  minimap: {
    polyline: [number, number][];
    origin_name: string;
    dest_name: string;
  };
  segments: LevelSegment[];
}
