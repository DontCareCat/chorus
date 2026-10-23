import { Icon } from "./Icon";
import { useLayout } from "../hooks/useLayout";
import { Select } from "./Select";
import { en } from "../i18n/en";
import { SORT_KEYS } from "../lib/library-sort";
import type { SortChoice, SortKey } from "../lib/library-sort";

const options = SORT_KEYS.map((k) => ({ value: k, label: en.library.sort.keys[k] }));

/** The library's sort button (guide section 17): a dropdown with the five keys and a direction button that turns over. On phones the dropdown is just an icon, so the sort control fits beside Play all and Shuffle. */
export function SortControl({ choice, onChange }: { choice: SortChoice; onChange: (c: SortChoice) => void }) {
  const phone = useLayout() === "phone";
  const reversed = choice.dir === "reverse";
  const label = en.library.sort.dirs[choice.key][reversed ? 1 : 0];
  return (
    <div className="sort-control" role="group" aria-label={en.library.sort.label}>
      <Select<SortKey> value={choice.key} options={options} ariaLabel={phone ? `${en.library.sort.label}: ${en.library.sort.keys[choice.key]}` : en.library.sort.label} icon={phone ? "sortIcon" : undefined} onChange={(key) => onChange({ key, dir: "default" })} />
      <button type="button" className="icon-btn sort-dir" data-reversed={reversed} aria-label={`${en.library.sort.direction}: ${label}`} title={label} onClick={() => onChange({ key: choice.key, dir: reversed ? "default" : "reverse" })}>
        <Icon name="arrowUp" />
      </button>
    </div>
  );
}
