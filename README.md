# Pitch Black collector

A standalone static checklist for the 120 numbered English Pokémon TCG Mega Evolution—Pitch Black cards and their 199 available normal, holo and reverse holo finishes.

Open the published page and tap each finish you own. Collection state is stored only in that browser's local storage. Use **Export checklist** to download a backup and **Import checklist** to restore it in another browser. There is no account or cloud sync.

The checked-in `cards.json` snapshot was generated from [TCGdex](https://tcgdex.dev/) on 7 October 2026 (Australia/Melbourne). It includes TCGplayer ungraded market prices in USD. The page refreshes prices from TCGdex after the saved snapshot is over six hours old, and the **Refresh prices** button can request them sooner. If the price service is unavailable, the page keeps the saved values and shows their last update time. Five normal finishes had no published market price in the initial snapshot, so they display a dash. Card images load from TCGdex and need an internet connection.

AUD amounts are approximate conversions of USD market prices using the latest available [Frankfurter](https://frankfurter.dev/) USD/AUD rate. They are not Australian market sale prices. The page displays the source price update time and exchange-rate date.

To update the fallback snapshot locally, run `python3 update-data.py`. The site itself needs no build tools: serve this directory as static files or deploy it through GitHub or Vercel.
