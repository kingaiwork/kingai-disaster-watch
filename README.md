# KINGAI Disaster Watch

Public multi-hazard situational-awareness website for the United States, covering earthquakes, tsunamis, volcanoes and tornadoes.

## Production target

- Primary domain: `https://hazard.kingai.work`
- Cloudflare Pages project: `kingai-disaster-watch`
- Runtime: static frontend + Cloudflare Pages Functions
- Private analytics/model repository: `kingaiwork/kingai-hazard-core`

## Scientific scope

This project does **not** claim to predict the exact time/location of earthquakes, volcanic eruptions, tsunamis, tornadoes, or a literal “end of the world.” It combines authoritative observations, official warnings, short-horizon hazard products, anomaly detection and transparent scenario scoring.

The public `Extreme Multi-Hazard Scenario Index (EMHSI)` is a 0–100 situational-severity index. It is **not a probability that an apocalypse will occur**.

## Authoritative upstream sources

- Earthquake: USGS Earthquake Hazards Program real-time GeoJSON feeds.
- Tsunami: NOAA / U.S. Tsunami Warning System ATOM/CAP products.
- Volcano: USGS Volcano Hazards Program HANS API.
- Tornado: NOAA/NWS CAP/JSON alert API. A future release will add NOAA Storm Prediction Center convective outlook layers.

## Architecture

```text
USGS / NOAA / NWS
      │
      ▼
Cloudflare Pages Functions
  /api/earthquakes
  /api/tornadoes
  /api/tsunami
  /api/volcanoes
  /api/status
      │
      ├── cache + source timestamps
      ├── transparent v1 scoring
      ▼
Browser dashboard + national map
      │
      ▼
Optional private intelligence API
kingai-hazard-core (future production model)
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

Official emergency instructions always take precedence over KINGAI scoring. Source age and degraded-source states are displayed rather than silently converted to a false “safe” result.
