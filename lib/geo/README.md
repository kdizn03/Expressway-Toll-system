# Philippine boundary data

`philippines-boundary.json` holds the outer rings of the Philippines (`ADM0_A3 = PHL`, 97 polygons, 7,406 vertices, coordinates rounded to 5 decimals ≈ 1 m) used by `philippines.ts` to decide whether a location or route is inside the Philippines.

- **Source:** [Natural Earth](https://www.naturalearthdata.com/) 1:10m Cultural Vectors, Admin 0 – Countries, **v5.1.2** (`ne_10m_admin_0_countries.geojson` from <https://github.com/nvkelso/natural-earth-vector/tree/v5.1.2/geojson>).
- **Licence:** public domain ([Natural Earth terms of use](https://www.naturalearthdata.com/about/terms-of-use/)); no attribution required.
- **Boundaries:** Natural Earth's default *de facto* view. It does not include the Kalayaan Island Group (Spratlys) or the Turtle Islands, which have no road connection to the rest of the country and so cannot be origins or destinations of a driving route anyway.

It also contains two derived layers, produced by the same script:

- `archipelagoHull` – the convex hull of Philippine land (19 vertices), an approximation of the archipelagic waters.
- `foreignLandInHull` – other countries' land clipped to that hull. With v5.1.2 this is one piece of north-eastern Sabah, Malaysia (44 vertices); Indonesia and Taiwan lie entirely outside the hull.

## How it is used

- **Origins and destinations** (`isInPhilippines`): accepted when on Philippine land **or within 22.2 km (12 nautical miles, the territorial sea)** of it. The buffer covers coastline generalisation (reclaimed land such as the Mall of Asia complex is ~0.2 km outside the 1:10m coastline, Subic port ~1.4 km) and small islands missing from the 1:10m data (Corregidor ~6.5 km). The nearest foreign land is 36.5 km from Philippine land (an islet off Sabah), so the buffer never reaches another country.
- **Route geometry** (`isOnPhilippineRoute`, sampled about every 1 km and along long segments): additionally accepts points inside the archipelago hull that are not on foreign land. Without this, inter-island ferry legs in the Sibuyan and Visayan Seas (more than 22 km from the generalised coast) would be rejected. A driving route can only leave the Philippines across foreign land, which is excluded.

`tests/philippines-geo.test.ts` checks known Philippine and foreign locations, ferry waters, Sabah, and the buffer-versus-gap margin.

## Luzon coverage (`luzon-coverage.json`, `luzon.ts`)

The app's supported coverage is the **Luzon main island**. The whole supported expressway network (NLEX, SCTEX, TPLEX, SLEX, Skyway, STAR, CAVITEX, CALAX, NAIAX, MCX, C5 Link) is on it, and every place on it can be reached by road without a ferry.

- `luzon` is the Natural Earth ring that contains Manila (1,494 vertices). It runs from Aparri in the north to Matnog in Sorsogon, including Bataan, Zambales, Batangas, Quezon, and the Bicol peninsula.
- `nearbyIslands` are the three other land rings within 5 km of it. They are separate islands, so points inside them are excluded.
- A point is covered when it is inside `luzon`, or within **3 km** of it and not on another island. The tolerance covers reclaimed waterfronts and ports (Mall of Asia 0.2 km, Subic port 1.4 km) but stays well below the gap to the nearest ferry-only islands (Corregidor 6.5 km, Alabat 14.5 km, Mindoro 16.9 km, Catanduanes 32.6 km).
- **Not covered**, although part of the Luzon island group: Mindoro, Marinduque, Romblon, Masbate, Catanduanes, Polillo, Alabat, Corregidor, Batanes, Babuyan, and Palawan. The Visayas, Mindanao, and other countries are also outside coverage.
- The file is 33 KB and is imported in the browser (autocomplete selections) and on the server, so both sides use exactly the same check.

## Updating

1. Download a newer `ne_10m_admin_0_countries.geojson` release.
2. Run `node scripts/extract-philippines-boundary.mjs <downloaded.geojson> lib/geo/philippines-boundary.json`, then `node scripts/extract-luzon-coverage.mjs`.
3. Run `npm test`. The boundary tests check known Philippine and foreign locations and the foreign-land gap.
