/**
 * Hand-written M1 level in the real LevelSpec schema: a fictionalised walk
 * from Bandra Station toward Hill Road. Replaced by POST /api/levels/ in M3.
 */
import type { LevelSpec } from './types';

export const sampleLevel: LevelSpec = {
  level_token: 'sample-m1',
  seed: 20260816,
  mode: 'dry',
  total_length_m: 520,
  minimap: {
    polyline: [
      [72.8403, 19.0544],
      [72.8407, 19.0533],
      [72.8399, 19.0521],
      [72.8385, 19.0513],
      [72.8371, 19.0508],
    ],
    origin_name: 'Bandra Station (W)',
    dest_name: 'Hill Road Junction',
  },
  segments: [
    {
      key: 'sample:0',
      name: 'Station Road',
      length_m: 120,
      road_class: 'tertiary',
      traffic_density: 0.6,
      vehicle_mix: { car: 0.3, rickshaw: 0.5, bus: 0.05, bike: 0.15 },
      footpath: { present: true, side: 'left', width_class: 'normal', confidence: 0.8 },
      bend_after_deg: -30,
      hazards: [
        { type: 'hawker_stall', lane: 'footpath', at_m: 18, span_m: 8, props: { passable_gap_m: 0.7 } },
        { type: 'broken_slab', lane: 'footpath', at_m: 40, props: {} },
        { type: 'parked_scooter', lane: 'footpath', at_m: 62, span_m: 6, props: { passable_gap_m: 0.7 } },
        { type: 'pole', lane: 'footpath', at_m: 76, props: {} },
        { type: 'open_drain', lane: 'footpath', at_m: 88, span_m: 2, props: { fall_damage: true } },
        { type: 'hawker_stall', lane: 'footpath', at_m: 104, span_m: 10, props: { passable_gap_m: 0.4 } },
      ],
      monsoon: {
        puddles: [{ lane: 'road_1', at_m: 30, span_m: 10, splash: true }],
        waterlogged: false,
      },
      pois: [
        { name: 'Bandra Book Depot', category: 'shop:books', at_m: 24, side: 'left' },
        { name: 'Hotel Sagar', category: 'restaurant', at_m: 58, side: 'right' },
        { name: 'Axis Bank ATM', category: 'atm', at_m: 96, side: 'left' },
      ],
      crossing_after: { type: 'signals', signal: true },
    },
    {
      key: 'sample:1',
      name: 'SV Road stretch',
      length_m: 140,
      road_class: 'secondary',
      traffic_density: 0.85,
      vehicle_mix: { car: 0.45, rickshaw: 0.3, bus: 0.15, bike: 0.1 },
      footpath: { present: true, side: 'left', width_class: 'narrow', confidence: 0.9 },
      hazards: [
        { type: 'pole', lane: 'footpath', at_m: 12, props: {} },
        { type: 'construction', lane: 'footpath', at_m: 34, span_m: 12, props: {} },
        // The classic trap: footpath dead-ends, forcing a road detour.
        { type: 'dead_end', lane: 'footpath', at_m: 70, span_m: 16, props: { forced_exit: 'road' } },
        { type: 'broken_slab', lane: 'footpath', at_m: 104, props: {} },
        { type: 'open_drain', lane: 'footpath', at_m: 122, span_m: 2, props: { fall_damage: true } },
      ],
      monsoon: {
        puddles: [
          { lane: 'road_1', at_m: 60, span_m: 14, splash: true },
          { lane: 'road_2', at_m: 100, span_m: 8, splash: true },
        ],
        waterlogged: false,
      },
    },
    {
      key: 'sample:2',
      name: 'Market lane',
      length_m: 100,
      road_class: 'residential',
      traffic_density: 0.35,
      vehicle_mix: { car: 0.2, rickshaw: 0.5, bus: 0, bike: 0.3 },
      // Side flip: footpath switches to the right after the junction.
      footpath: { present: true, side: 'right', width_class: 'normal', confidence: 0.6 },
      bend_after_deg: 25,
      hazards: [
        { type: 'hawker_stall', lane: 'footpath', at_m: 10, span_m: 20, props: { passable_gap_m: 0.7 } },
        { type: 'hawker_stall', lane: 'footpath', at_m: 44, span_m: 16, props: { passable_gap_m: 0.7 } },
        { type: 'parked_scooter', lane: 'footpath', at_m: 74, span_m: 8, props: { passable_gap_m: 0.4 } },
      ],
      monsoon: { puddles: [], waterlogged: true },
      pois: [
        { name: 'Noor Mohammadi Hotel', category: 'restaurant', at_m: 20, side: 'right' },
        { name: 'Fish Market', category: 'marketplace', at_m: 56, side: 'right' },
      ],
      crossing_after: { type: 'zebra', signal: false },
    },
    {
      key: 'sample:3',
      name: 'Hill Road',
      length_m: 160,
      road_class: 'secondary',
      traffic_density: 0.8,
      vehicle_mix: { car: 0.4, rickshaw: 0.35, bus: 0.1, bike: 0.15 },
      footpath: { present: true, side: 'right', width_class: 'normal', confidence: 0.9 },
      hazards: [
        { type: 'broken_slab', lane: 'footpath', at_m: 20, props: {} },
        { type: 'hawker_stall', lane: 'footpath', at_m: 48, span_m: 12, props: { passable_gap_m: 0.7 } },
        { type: 'barrier', lane: 'footpath', at_m: 84, span_m: 4, props: {} },
        { type: 'pole', lane: 'footpath', at_m: 100, props: {} },
        { type: 'open_drain', lane: 'footpath', at_m: 110, span_m: 2, props: { fall_damage: true } },
        { type: 'parked_scooter', lane: 'footpath', at_m: 134, span_m: 8, props: { passable_gap_m: 0.7 } },
      ],
      monsoon: {
        puddles: [{ lane: 'road_1', at_m: 90, span_m: 12, splash: true }],
        waterlogged: false,
      },
      pois: [
        { name: 'Candies', category: 'cafe', at_m: 30, side: 'right' },
        { name: 'St. Andrew’s Church', category: 'place_of_worship', at_m: 76, side: 'right' },
        { name: 'Elco Market', category: 'shop:clothes', at_m: 120, side: 'left' },
      ],
    },
  ],
};
