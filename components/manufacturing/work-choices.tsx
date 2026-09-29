"use client";
import { useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { normalize } from "@/lib/manufacturing/domain";

/** Keep small sets easy to tap, and long sets easy to scan and search. */
export function WorkChoices({
  items, label, disabled, onChoose,
}: {
  items: { id: string; name: string }[];
  label: "categories" | "activities";
  disabled: boolean;
  onChoose: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const searchable = items.length > 12;
  const visible = searchable
    ? items.filter((item) => normalize(item.name).includes(normalize(query)))
    : items;
  const layout = items.length <= 4 ? "large" : items.length <= 6 ? "medium" : items.length <= 8 ? "small" : "list";
  return (
    <div className="work-choices">
      {searchable && (
        <label className="search-box work-choice-search">
          <Search size={19} aria-hidden="true" />
          <input
            aria-label={`Search ${label}`}
            placeholder={`Search ${label}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      )}
      <div
        className={`work-choice-options work-choice-${layout}${items.length === 1 ? " work-choice-single" : ""}`}
        role="group"
        aria-label={`Choose from your ${label}`}
      >
        {visible.map((item) => (
          <button
            type="button"
            className="work-choice"
            key={item.id}
            disabled={disabled}
            onClick={() => onChoose(item.id)}
          >
            <strong>{item.name}</strong>
            <ArrowRight size={20} aria-hidden="true" />
          </button>
        ))}
      </div>
      {searchable && !visible.length && <p className="empty" role="status">No matching {label}.</p>}
    </div>
  );
}
