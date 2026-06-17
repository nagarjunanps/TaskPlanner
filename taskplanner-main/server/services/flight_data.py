"""Flight data provider abstraction.

FLIGHT_DATA_PROVIDER env var: "mock" (default) | "aerodatabox"
For aerodatabox, set AERODATABOX_API_KEY too.
"""
import os
import re
from abc import ABC, abstractmethod
from datetime import date


class FlightDataProvider(ABC):
    @abstractmethod
    def fetch_flights(self, station: str, scheduled_date: date) -> list[dict]:
        """Return a list of raw flight dicts with keys matching the Flight model."""


def _build_mock_schedule(count: int = 100) -> list[tuple]:
    """Deterministically generate `count` AirAsia KUL turnarounds spread roughly
    evenly across a full operating day (05:00–05:00 next day), so every shift
    (S1-S4) gets a comparable share of traffic.  Same seed → same output every run."""
    import random
    rng = random.Random(42)

    # 12 even 2h blocks spanning 05:00 today to 05:00 next day; block end_min
    # may exceed 1440 (wrapped back into 0-23:59 below). Counts are split as
    # evenly as possible across blocks so total always equals `count`.
    N_BLOCKS = 12
    base, extra = divmod(count, N_BLOCKS)
    block_counts = [base + 1] * extra + [base] * (N_BLOCKS - extra)
    windows = [
        (300 + i * 120, 420 + i * 120, n)
        for i, n in enumerate(block_counts)
    ]

    sta_pool: list[int] = []
    for start, end, n in windows:
        for _ in range(n):
            sta_pool.append(rng.randint(start, end - 1))
    sta_pool.sort()
    sta_pool = [m % 1440 for m in sta_pool]

    sectors   = ['J', 'L', 'P', 'Q']
    ac_types  = ['A320', 'A320', 'A320', 'A321', 'A321']   # 60/40 split

    schedule: list[tuple] = []
    for i, sta_min in enumerate(sta_pool[:count]):
        ac_type   = rng.choice(ac_types)
        ground    = 30 if ac_type == 'A320' else 35
        std_min   = (sta_min + ground) % 1440

        # Unique 9M-XXX registration (no two turnarounds share a plane)
        a = chr(65 + i // 225)           # 'A' for 0-224, 'B' for 225+
        b = chr(65 + (i // 15) % 15)
        c = chr(65 + i % 15)
        reg = f"9M-{a}{b}{c}"

        bay = f"{sectors[i % 4]}{(i % 31) + 1:02d}"

        # Cargo weight distribution (matches notes: <1.5t=1set, 1.5-10t=2set, >10t=3set)
        r = rng.random()
        if r < 0.50:
            cargo = round(rng.uniform(0.3, 1.4), 1)    # 50% light  → 1 set
        elif r < 0.85:
            cargo = round(rng.uniform(1.5, 8.9), 1)    # 35% medium → 2 sets
        else:
            cargo = round(rng.uniform(10.0, 12.5), 1)  # 15% heavy  → 3 sets

        sta = f"{sta_min // 60:02d}:{sta_min % 60:02d}"
        std = f"{std_min // 60:02d}:{std_min % 60:02d}"

        schedule.append((
            f"AK{1000 + i * 2}",   # arrival  flight number
            f"AK{1001 + i * 2}",   # departure flight number
            reg, ac_type, bay, cargo, sta, std,
        ))

    return schedule


class MockFlightProvider(FlightDataProvider):
    """100 AirAsia KUL turnarounds spread across a full operating day — for dev/demo."""

    _SCHEDULE = _build_mock_schedule(100)

    def fetch_flights(self, station: str, scheduled_date: date) -> list[dict]:
        flights = []
        for arr_fn, dep_fn, reg, ac_type, bay, cargo, sta, std in self._SCHEDULE:
            flights.append({
                "flight_number": arr_fn, "airline": "AK", "station": station,
                "scheduled_date": scheduled_date, "direction": "ARRIVAL",
                "scheduled_time": sta, "aircraft_registration": reg,
                "aircraft_type": ac_type, "bay": bay,
                "cargo_weight_tons": cargo, "status": "SCHEDULED",
            })
            flights.append({
                "flight_number": dep_fn, "airline": "AK", "station": station,
                "scheduled_date": scheduled_date, "direction": "DEPARTURE",
                "scheduled_time": std, "aircraft_registration": reg,
                "aircraft_type": ac_type, "bay": bay,
                "cargo_weight_tons": cargo, "status": "SCHEDULED",
            })
        return flights


class AeroDataBoxProvider(FlightDataProvider):
    """AeroDataBox Airport FIDS via RapidAPI."""

    BASE_URL = "https://aerodatabox.p.rapidapi.com/flights/airports/iata/{iata}/{date}T00:00/{date}T23:59"

    @staticmethod
    def _parse_time(raw_time: str | None) -> str | None:
        """Extract HH:MM from AeroDataBox local time strings like '2024-06-16 10:00+08:00'."""
        if not raw_time:
            return None
        m = re.search(r'(\d{2}:\d{2})', raw_time)
        return m.group(1) if m else None

    def fetch_flights(self, station: str, scheduled_date: date) -> list[dict]:
        try:
            import httpx
        except ImportError:
            raise RuntimeError("httpx is required for AeroDataBoxProvider: pip install httpx")

        api_key = os.environ.get("AERODATABOX_API_KEY", "")
        if not api_key:
            raise RuntimeError("AERODATABOX_API_KEY env var not set")

        iata = "KUL" if station in ("KUL", "KLIA") else station
        url = self.BASE_URL.format(iata=iata, date=scheduled_date.isoformat())
        print(f"[aerodatabox] Fetching {url}")
        resp = httpx.get(url, headers={
            "X-RapidAPI-Key": api_key,
            "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com",
        }, timeout=15)
        print(f"[aerodatabox] HTTP {resp.status_code}")
        resp.raise_for_status()
        raw = resp.json()

        flights = []
        for direction, key in (("ARRIVAL", "arrivals"), ("DEPARTURE", "departures")):
            for f in raw.get(key, []):
                movement    = f.get("movement", {})
                sched_time  = self._parse_time(movement.get("scheduledTime", {}).get("local"))
                est_time    = self._parse_time((movement.get("revisedTime") or {}).get("local"))
                if not sched_time:
                    continue

                bay = movement.get("gate") or movement.get("terminal") or None
                flights.append({
                    "flight_number": f.get("number", ""),
                    "airline": (f.get("airline") or {}).get("iata", "AK"),
                    "station": station,
                    "scheduled_date": scheduled_date,
                    "direction": direction,
                    "scheduled_time": sched_time,
                    "estimated_time": est_time,
                    "aircraft_registration": (f.get("aircraft") or {}).get("reg") or None,
                    "aircraft_type": (f.get("aircraft") or {}).get("model", "A320"),
                    "bay": bay,
                    "cargo_weight_tons": None,
                    "status": f.get("status", "SCHEDULED"),
                    "raw_json": str(f),
                })
        print(f"[aerodatabox] Parsed {len(flights)} flight legs.")
        return flights


def get_provider() -> FlightDataProvider:
    name = os.environ.get("FLIGHT_DATA_PROVIDER", "mock").lower()
    if name == "aerodatabox":
        return AeroDataBoxProvider()
    return MockFlightProvider()
