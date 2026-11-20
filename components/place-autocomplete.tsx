"use client";

import { useEffect, useId, useRef, useState } from "react";
import { importGoogleLibrary } from "./google-maps-loader";
import { isInLuzonCoverage, LUZON_SEARCH_BOUNDS } from "@/lib/geo/luzon";
import { LUZON_LOCATION_ERROR } from "@/lib/routing/messages";

/** A place chosen from Google Places autocomplete. */
export type SelectedPlace = { placeId: string; name: string; address?: string; latitude: number; longitude: number };
type Suggestion = { prediction: google.maps.places.PlacePrediction; main: string; secondary: string };

const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;

type Props = {
  id: string; name: string; label: string; placeholder?: string; required?: boolean;
  /** `error` is set when a selected place fails the Luzon coverage check (the same check the server applies). */
  value: string; onChange: (text: string, place?: SelectedPlace, error?: string) => void;
  /** Server-side validation message for this field (e.g. an overseas location). */
  error?: string;
};

/**
 * Text input with Google Places API (New) suggestions. One session token spans the
 * keystrokes of a search and ends with the Place Details (fetchFields) call on selection.
 * If Places is unavailable the field keeps working as plain text (resolved on the server).
 */
export function PlaceAutocomplete({ id, name, label, placeholder, required, value, onChange, error }: Props) {
  const errorId = useId();
  const listId = useId();
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [notice, setNotice] = useState("");
  const token = useRef<google.maps.places.AutocompleteSessionToken | undefined>(undefined);
  const requestId = useRef(0);
  const typed = useRef(false);

  useEffect(() => {
    if (!typed.current) return;
    const query = value.trim();
    if (query.length < MIN_CHARS) { setSuggestions([]); return; }
    const current = ++requestId.current;
    const timer = window.setTimeout(async () => {
      try {
        const places = await importGoogleLibrary("places");
        token.current ??= new places.AutocompleteSessionToken();
        const { suggestions: results } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: query, sessionToken: token.current, includedRegionCodes: ["ph"], locationRestriction: LUZON_SEARCH_BOUNDS, language: "en", region: "ph",
        });
        if (current !== requestId.current) return; // a newer keystroke superseded this response
        setSuggestions(results.flatMap((item) => item.placePrediction ? [{ prediction: item.placePrediction, main: item.placePrediction.mainText?.text ?? item.placePrediction.text.text, secondary: item.placePrediction.secondaryText?.text ?? "" }] : []));
        setActive(-1); setOpen(true); setNotice("");
      } catch {
        if (current !== requestId.current) return;
        setSuggestions([]); setNotice("Suggestions are unavailable right now. The typed place will be searched when you calculate.");
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [value]);

  async function choose(suggestion: Suggestion) {
    setOpen(false); setSuggestions([]); typed.current = false; requestId.current++;
    const text = suggestion.secondary ? `${suggestion.main}, ${suggestion.secondary}` : suggestion.main;
    onChange(text);
    try {
      // toPlace() carries the session token into this Place Details request, which ends the session.
      const place = suggestion.prediction.toPlace();
      await place.fetchFields({ fields: ["id", "displayName", "formattedAddress", "location"] });
      const location = place.location;
      if (!location) throw new Error("Selected place has no location.");
      // The suggestion rectangle still contains other islands (Mindoro, Marinduque, Catanduanes),
      // so the selection is checked against the Luzon coverage polygon before it is used.
      if (!isInLuzonCoverage([location.lng(), location.lat()])) { onChange(text, undefined, LUZON_LOCATION_ERROR); setNotice(""); return; }
      onChange(text, { placeId: place.id, name: place.displayName ?? suggestion.main, address: place.formattedAddress ?? undefined, latitude: location.lat(), longitude: location.lng() });
      setNotice("");
    } catch {
      setNotice("Could not load that place's details. The typed place will be searched when you calculate.");
    } finally {
      token.current = undefined; // the next search starts a new billing session
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => (index + 1) % suggestions.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => (index <= 0 ? suggestions.length : index) - 1); }
    else if (event.key === "Enter" && active >= 0) { event.preventDefault(); void choose(suggestions[active]); }
    else if (event.key === "Escape") { setOpen(false); }
  }

  const expanded = open && suggestions.length > 0;
  return <div className={`field placeField${error ? " invalid" : ""}`}>
    <label htmlFor={id}>{label}</label>
    <input
      id={id} name={name} required={required} placeholder={placeholder} autoComplete="off" value={value}
      role="combobox" aria-autocomplete="list" aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} aria-expanded={expanded} aria-controls={listId}
      aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
      onChange={(event) => { typed.current = true; onChange(event.target.value); }}
      onKeyDown={onKeyDown}
      onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
      onBlur={() => window.setTimeout(() => setOpen(false), 150)}
    />
    {expanded && <ul className="placeSuggestions" id={listId} role="listbox" aria-label={`${label} suggestions`}>
      {suggestions.map((suggestion, index) => <li key={suggestion.prediction.placeId} id={`${listId}-${index}`} role="option" aria-selected={index === active} className={index === active ? "active" : ""}
        onMouseDown={(event) => { event.preventDefault(); void choose(suggestion); }} onMouseEnter={() => setActive(index)}>
        <b>{suggestion.main}</b>{suggestion.secondary && <span>{suggestion.secondary}</span>}
      </li>)}
      <li className="poweredBy" aria-hidden="true">Luzon locations · Powered by Google</li>
    </ul>}
    {error && <small className="placeError" id={errorId} role="alert">{error}</small>}
    {notice && <small className="placeNotice">{notice}</small>}
  </div>;
}
