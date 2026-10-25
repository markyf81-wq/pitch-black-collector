#!/usr/bin/env python3
"""Refresh both numbered sets and their indicative Cardmarket prices from TCGdex."""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
BASE = "https://api.tcgdex.net/v2/en"
SETS = {"me04": ("Chaos Rising", 122), "me05": ("Pitch Black", 120)}
FINISHES = {"normal": "normal", "holo": "holofoil", "reverse": "reverse-holofoil"}


def get_json(url):
    request = Request(url, headers={"User-Agent": "PokemonCardCollection/1.0"})
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def variant_id(detail):
    finish = FINISHES.get(detail.get("type"))
    if not finish:
        return None
    stamps = detail.get("stamp") or []
    return finish + ("-" + "-".join(stamps) if stamps else "")


def market_price(detail):
    market = (detail.get("pricing") or {}).get("cardmarket") or {}
    # Cardmarket publishes one product price for several finishes. Its holo
    # average is the closest available estimate for reverse and regular holo.
    if detail.get("stamp"):
        candidates = (market.get("avg"), market.get("avg-holo"))
    elif detail.get("type") in ("reverse", "holo"):
        candidates = (market.get("avg-holo"), market.get("avg"))
    else:
        candidates = (market.get("avg"), market.get("avg-holo"))
    return next((value for value in candidates if isinstance(value, (int, float)) and value > 0), None)


def load_card(brief):
    card = get_json(f"{BASE}/cards/{brief['id']}")
    details = card.get("variants_detailed") or []
    variants = []
    prices = {}
    updated = []
    for detail in details:
        key = variant_id(detail)
        if not key or key in variants:
            continue
        variants.append(key)
        price = market_price(detail)
        if price is not None:
            prices[key] = price
        date = ((detail.get("pricing") or {}).get("cardmarket") or {}).get("updated")
        if date:
            updated.append(date)
    if not variants:
        raise RuntimeError(f"No finishes for {card['id']}")
    return {
        "id": card["id"],
        "setId": card["set"]["id"],
        "number": card["localId"],
        "name": card["name"],
        "rarity": card.get("rarity") or "Unknown",
        "category": card.get("category") or "Unknown",
        "image": f"{card['image']}/low.webp" if card.get("image") else None,
        "variants": variants,
        "prices": prices,
        "priceUpdated": max(updated, default=None),
    }


cards = []
for set_id, (_, expected) in SETS.items():
    briefs = get_json(f"{BASE}/sets/{set_id}")["cards"]
    if len(briefs) != expected:
        raise RuntimeError(f"Expected {expected} cards in {set_id}, got {len(briefs)}")
    with ThreadPoolExecutor(max_workers=12) as pool:
        set_cards = list(pool.map(load_card, briefs))
    set_cards.sort(key=lambda card: int(card["number"]))
    if [card["number"] for card in set_cards] != [f"{n:03d}" for n in range(1, expected + 1)]:
        raise RuntimeError(f"Incomplete numbering in {set_id}")
    cards.extend(set_cards)

fx = get_json("https://api.frankfurter.dev/v2/rate/eur/aud")
snapshot = {
    "sets": [{"id": set_id, "name": name, "count": count} for set_id, (name, count) in SETS.items()],
    "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    "source": "TCGdex / Cardmarket",
    "priceCurrency": "EUR",
    "fx": {"rate": fx["rate"], "date": fx["date"]},
    "cards": cards,
}
(ROOT / "cards.json").write_text(json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")) + "\n")
missing = [f"{card['id']}:{kind}" for card in cards for kind in card["variants"] if kind not in card["prices"]]
print(f"Wrote {len(cards)} cards, {sum(len(card['variants']) for card in cards)} finishes; {len(missing)} missing estimates")
print(f"Cardmarket as of {max(card['priceUpdated'] or '' for card in cards)}; EUR/AUD {fx['rate']} on {fx['date']}")
