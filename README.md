# KINGAI Disaster Watch

Public multi-hazard situational-awareness website for the United States and covered U.S. territories, monitoring earthquakes, tsunamis, volcanoes and tornadoes.

## Production target

- Primary domain: `https://hazard.kingai.work`
- Cloudflare Pages project: `kingai-disaster-watch`
- Runtime: static frontend + Cloudflare Pages Functions
- Private analytics/model repository: `kingaiwork/kingai-hazard-core`

## Scientific scope

This project does **not** claim to predict the exact time/location of earthquakes, volcanic eruptions, tsunamis, tornadoes, or a literal “end of the world.” It combines authoritative observations, official warnings, short-horizon hazard products, anomaly detection and transparent scenario scoring.

The public `Extreme Multi-Hazard Scenario Index (EMHSI)` is a 0–100 situational-severity index. It is **not a probability that an apocalypse will occur**.\n\nThe dashboard also exposes the experimental `KINGAI Hybrid Signal Ensemble (KHSE)` with 6h, 24h and 72h operational-attention projections. KHSE is intentionally explainable: it combines hazard-specific signal persistence, source freshness and official forecast evidence where available. Its score is **not an occurrence probability** and it does not claim exact-event prediction.

## Authoritative upstream sources

- Earthquake: USGS Earthquake Hazards Program FDSN/GeoJSON data for the contiguous U.S., Alaska, Hawaii, Puerto Rico/U.S. Virgin Islands, Guam/Northern Mariana Islands and American Samoa.
- Tsunami: NOAA / U.S. Tsunami Warning System NTWC/PTWC ATOM products, with a 24-hour freshness gate for warning/watch/advisory scoring.
- Volcano: USGS Volcano Hazards Program HANS API, selecting the latest notice per volcano rather than an older maximum alert.
- Tornado: NOAA/NWS active warning/watch API plus the official NOAA/NWS Storm Prediction Center Day 1 probabilistic tornado outlook. SPC probability is displayed as forecast evidence and does not yet change the EMHSI tornado score.

## Architecture

```text
USGS / NOAA / NWS
      │
      ▼
Cloudflare Pages Functions
  /api/status
      │
      ├── four authoritative hazard families
      ├── SPC Day 1 official tornado probability
      ├── source latency + evidence age
      ├── coverage / source-confidence telemetry
      └── transparent versioned EMHSI scoring
      ▼
Browser dashboard + national map
      │
      └──────────────► VPS 5-minute sanitized history snapshots
                        + trend queries
                        + stateful anomaly detection
                               │
                               ▼
                    kingai-hazard-core (PRIVATE)
```

## Local development

```bash
npm install
npm run dev
```

## Deploy

```bash
npm run deploy
```

Cloudflare deployment is automated from the KINGAI operations repository so account credentials remain outside this public repository.

## Safety and reliability

Official emergency instructions always take precedence over KINGAI scoring. Source age and degraded-source states are displayed rather than silently converted to a false “safe” result.\n\n### Projection safeguards\n\n- Earthquake: current-activity persistence only; no exact time/place/magnitude prediction.\n- Tsunami: persistence of official message state only; no prediction of a new tsunami.\n- Volcano: persistence of the latest official USGS alert-state evidence.\n- Tornado: active NWS alerts plus the official SPC Day 1 probability while the requested horizon remains inside the product valid period.\n- Longer horizons receive lower confidence and wider uncertainty.\n- Experimental projection coefficients are not fed back into current EMHSI scoring.
