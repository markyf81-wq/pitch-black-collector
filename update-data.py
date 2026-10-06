#!/usr/bin/env python3
"""Refresh the checked-in Pitch Black card and price snapshot from TCGdex."""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
import json
from pathlib import Path
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
BASE = "https://api.tcgdex.net/v2/en"


def get_json(url):
    request = Request(url, headers={"User-Agent": "PitchBlackCollector/1.0"})
    with urlopen(request, timeout=25) as response:
        return json.load(response)


set_data = get_json(f"{BASE}/sets/me05")
briefs = set_data["cards"]
if len(briefs) != 120:
    raise RuntimeError(f"Expected 120 cards, got {len(briefs)}")


def load_card(brief):
    card = get_json(f"{BASE}/cards/{brief['id']}")
    market = card.get("pricing", {}).get("tcgplayer", {})
    prices = {
        kind: variant.get("marketPrice")
        for kind, variant in market.items()
        if isinstance(variant, dict) and variant.get("marketPrice") is not None
    }
    variants = card.get("variants", {})
    available = [
        kind
        for flag, kind in (("normal", "normal"), ("holo", "holofoil"), ("reverse", "reverse-holofoil"))
        if variants.get(flag)
    ]
    return {
        "id": card["id"],
        "number": card["localId"],
        "name": card["name"],
        "rarity": card.get("rarity", "Unknown"),
        "category": card.get("category", "Unknown"),
        "image": f"{card['image']}/low.webp" if card.get("image") else None,
        "variants": available,
        "prices": prices,
        "priceUpdated": market.get("updated"),
    }


cards = []
with ThreadPoolExecutor(max_workers=8) as pool:
    futures = {pool.submit(load_card, brief): brief for brief in briefs}
    for future in as_completed(futures):
        cards.append(future.result())
cards.sort(key=lambda card: int(card["number"]))
if [card["number"] for card in cards] != [f"{n:03d}" for n in range(1, 121)]:
    raise RuntimeError("Set numbering is incomplete or out of order")

fx = get_json("https://api.frankfurter.dev/v2/rate/usd/aud")
snapshot = {
    "set": "Pitch Black",
    "setId": "me05",
    "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    "source": "TCGdex / TCGplayer",
    "fx": {"rate": fx["rate"], "date": fx["date"]},
    "cards": cards,
}
(ROOT / "cards.json").write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n")
missing = [f"{card['number']}:{kind}" for card in cards for kind in card["variants"] if kind not in card["prices"]]
print(f"Wrote {len(cards)} cards, {sum(len(card['variants']) for card in cards)} variants; {len(missing)} missing market prices: {', '.join(missing) or 'none'}")
print(f"TCGplayer as of {max(card['priceUpdated'] or '' for card in cards)}; AUD rate {fx['rate']} on {fx['date']}")
