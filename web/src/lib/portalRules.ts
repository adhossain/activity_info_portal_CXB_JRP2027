import type { FormElement } from "./api.js";
import { truthy, tryEval } from "./formula.js";
import type { Val } from "./formula.js";
import { enumIds, refLabel, refList, splitRef } from "./scope.js";
import { generateRecordId } from "./cuid.js";
import type { RecordNode } from "./formStore.js";
import type { FlatRow, FormStore, RecordScope } from "./scope.js";

/**
 * Checks the portal adds on top of the rules defined in ActivityInfo, for the
 * JRP 2027-28 Project Submission form. Field ids come from the ActivityInfo schema.
 */

type Band = "F<1" | "M<1" | "F1-4" | "M1-4" | "F5-11" | "M5-11" | "F12-17" | "M12-17" | "F18-59" | "M18-59" | "F60+" | "M60+";

interface FieldRule {
  /** Choices of a choice field that the portal no longer offers. */
  hiddenOptions?: string[];
  maxLength?: number;
  wholeNumber?: boolean;
  email?: boolean;
  minSelected?: number;
  /** Capped by the population of the record's group and upazila (sum of these bands). */
  population?: Band[];
  /** Must not exceed the value of this (calculated) field in the same record. */
  atMostField?: string;
  /** Month ("YYYY-MM") within this range, and not before the month in `notBefore`. */
  monthRange?: { min: string; max: string; notBefore?: string };
  /**
   * Reference fields: an ActivityInfo-style formula each chosen record must satisfy,
   * evaluated like a reference field's validation rule (it also filters the list).
   */
  choiceRule?: { formula: string; message: string };
}

const MAIN = "c3ps6s8mtpqc5842";
const ACTIVITIES = "c9rubwsmtsb6gxw5";
const TARGETS = "cub44qfmtv87793k";
const CROSS_CUTTING = "c1psa8tmu9k3rfx5";

const UNDER_18_F: Band[] = ["F<1", "F1-4", "F5-11", "F12-17"];
const UNDER_18_M: Band[] = ["M<1", "M1-4", "M5-11", "M12-17"];
const TOTAL_INDIVIDUALS = "c3vvb1bmujnotntf";
const LOCATION_METHOD = "c4hm1ilmupbi8ek7";
const METHOD_BULK = "cyeumixmupbi8ek6";
const METHOD_MULTIPLE = "coabcs7mupbiys68";
const CAMPS_MULTI = "cpbuvk8mup9thvy3";
const BLOCKS_MULTI = "cofm5bdmup9u2mi4";
const LOCATIONS_SUBFORM = "cpyu91omtsbcrlyf";
const LOCATIONS_FORM = "cpzuby7mtsbcrlye";
const LOCATION_CAMP = "chzhvvbmtv21q891e";
const LOCATION_BLOCK = "cq6o8yfmtv1yril1d";
const CAMPS_FORM = "cph69t1mttyk96l5ke4";

const RULES: Record<string, Record<string, FieldRule>> = {
  [MAIN]: {
    // ActivityInfo's own date rules use || and check the start date twice, so they accept anything.
    c6wv6bomub4elmza: { monthRange: { min: "2027-01", max: "2028-12" } },
    cb7i6okmub4gk9kb: { monthRange: { min: "2027-01", max: "2028-12", notBefore: "c6wv6bomub4elmza" } },
    cqwl1w1mujpev2e11: { email: true },
    cs5fphumujpjo2o18: { email: true },
  },
  [ACTIVITIES]: {
    // Same rules ActivityInfo applies to "Camp or Union" and "Block" in 2.A-Locations.
    // Only bulk upload into 2.A-Locations is used; ActivityInfo exports nothing else as locations.
    [LOCATION_METHOD]: { hiddenOptions: [METHOD_MULTIPLE] },
    cpbuvk8mup9thvy3: {
      choiceRule: {
        formula: `ckllle4mtsg3apjm == "Refugees & Host Community" || cpbuvk8mup9thvy3.cvqj76rmttkqjgs4 == "Refugees & Host Community" || cpbuvk8mup9thvy3.cvqj76rmttkqjgs4 == ckllle4mtsg3apjm`,
        message: "These camps or unions are not for this activity's target population",
      },
    },
    cofm5bdmup9u2mi4: {
      choiceRule: {
        formula: "cofm5bdmup9u2mi4.c4eiymxmucft0eu4 == cpbuvk8mup9thvy3",
        message: "These blocks are not in the selected camps or unions",
      },
    },
    cosemijmtsbbmvm9: { wholeNumber: true },
    c6jeggdmtsbbw3fa: { wholeNumber: true },
    crbgi70mtsbc0m9b: { wholeNumber: true },
    co8kyolmtsbc6qcc: { wholeNumber: true },
  },
  [CROSS_CUTTING]: {
    cs6zukmu9n7f0ml: { minSelected: 2 },
    // 1,500 per the JRP 2027 template; the EPR answer keeps the 1,000 stated in ActivityInfo.
    cb3n6kdmu9mukhx8: { maxLength: 1500 },
    cp7te74mu9mvpu19: { maxLength: 1500 },
    cpmougpmu9mwxuqa: { maxLength: 1500 },
    cb03si8mu9nb1bbq: { maxLength: 1500 },
    c3cj8gbmujcts7x6: { maxLength: 1500 },
    csnz1z5mub6p65917: { maxLength: 1500 },
    c5alav1mub6q1k118: { maxLength: 1500 },
  },
  [TARGETS]: {
    cjpw0vemudndxv8w: { population: UNDER_18_F },
    c1r49pkmudndxv8x: { population: UNDER_18_M },
    c1s3voymudndxv8y: { population: ["F18-59"] },
    cg69h5zmudndxv8z: { population: ["M18-59"] },
    c3pau46mudndxv810: { population: ["F60+"] },
    c3lmcl0mudndxv811: { population: ["M60+"] },
    cxb0v0umudndxv816: { population: ["F1-4"] },
    cqsv7nimudndxv817: { population: ["M1-4"] },
    c2c5r88mudndxv818: { population: ["F5-11", "F12-17"] },
    cfok2ymmudndxv819: { population: ["M5-11", "M12-17"] },
    ckk3mtwmudndxv81a: { population: ["F12-17"] },
    che34emudndxv81b: { population: ["M12-17"] },
    cckn5pmudndxv81c: { population: ["F18-59"] },
    cc3yl7bmudndxv81d: { population: ["M18-59"] },
    cgkn5famudndxv81e: { population: ["F18-59"] },
    c27eof4mudndxv81f: { population: ["M18-59"] },
    cxp7pyimudndxv812: { atMostField: TOTAL_INDIVIDUALS },
    cm7q54emudndxv813: { atMostField: TOTAL_INDIVIDUALS },
    cd87ng3mudndxv814: { atMostField: TOTAL_INDIVIDUALS },
    cms47vmup9zfui4: { wholeNumber: true, atMostField: TOTAL_INDIVIDUALS },
    co3qon3mupa0rzi5: { wholeNumber: true, atMostField: TOTAL_INDIVIDUALS },
    coso3ytmupa12ox6: { wholeNumber: true, atMostField: TOTAL_INDIVIDUALS },
  },
};

/** Checks on a whole record (shown on the row), as ActivityInfo-style formulas that must hold. */
const RECORD_RULES: Record<string, { formula: string; message: string }[]> = {
  [ACTIVITIES]: [
    {
      // On final submission every activity needs a location: rows in 2.A-Locations or chosen camps.
      formula: "!@parent.cc4bs3imujp98cuu.cdiiqhsmujp98cut || COUNT(cpyu91omtsbcrlyf._id) > 0 || COUNT(cpbuvk8mup9thvy3) > 0",
      message: "Add at least one location for this activity. Locations are needed for the final submission.",
    },
  ],
};

export function recordError(scope: RecordScope): string | undefined {
  for (const rule of RECORD_RULES[scope.schema.id] ?? []) {
    const r = tryEval(rule.formula, scope);
    if (r !== undefined && !truthy(r)) return rule.message;
  }
  return undefined;
}

const POPULATION_FORM = "ce8djtpmtqtq8sq1e";
const TARGET_GROUP_FIELD = "cqzw8jomtv8jo4zp";
const TARGET_AREA_FIELD = "c5w53k6mtv8kb5ys";

const BAND_COLUMNS: Record<Band, string> = {
  "F<1": "Female_below_1yr", "M<1": "Male_Below_1yr",
  "F1-4": "Female_between_1-4yrs", "M1-4": "Male_between_1-4yrs",
  "F5-11": "Female_between_5-11yrs", "M5-11": "Male_between_5-11yrs",
  "F12-17": "Female_between_12-17yrs", "M12-17": "Male_between_12-17yrs",
  "F18-59": "Female_between_18-59yrs", "M18-59": "Male_between_18-59yrs",
  "F60+": "Female_above_59yrs", "M60+": "Male_above_59yrs",
};

/** Reference tables the portal rules read, beyond those the form itself links to. */
export function extraRowForms(rootFormId: string): string[] {
  return rootFormId === MAIN ? [POPULATION_FORM] : [];
}

function ruleFor(el: FormElement, formId: string): FieldRule | undefined {
  return RULES[formId]?.[el.id];
}

/** Character limit from the portal rules, or the "max. 3,000 characters" stated in the field's description. */
export function maxLengthFor(el: FormElement, formId: string): number | undefined {
  const explicit = ruleFor(el, formId)?.maxLength;
  if (explicit) return explicit;
  if (el.type !== "NARRATIVE" && el.type !== "FREE_TEXT") return undefined;
  const m = /max(?:imum)?\.?\s*([\d,]+)\s*char/i.exec(el.description ?? "");
  return m ? Number(m[1].replace(/,/g, "")) : undefined;
}

const sumsCache = new WeakMap<FlatRow[], Map<string, Record<Band, number>>>();

function populationSums(rows: FlatRow[], group: string, area: string): Record<Band, number> | undefined {
  let cache = sumsCache.get(rows);
  if (!cache) {
    cache = new Map();
    sumsCache.set(rows, cache);
  }
  const key = `${group}|${area}`;
  if (!cache.has(key)) {
    const sums = Object.fromEntries(Object.keys(BAND_COLUMNS).map((b) => [b, 0])) as Record<Band, number>;
    let any = false;
    for (const r of rows) {
      if (r.settlement_for !== group) continue;
      if (r.Upazila !== area && r["camp.Upazila"] !== area && r["camp.Camp"] !== area) continue;
      for (const [b, col] of Object.entries(BAND_COLUMNS) as [Band, string][]) {
        const v = r[col];
        if (typeof v === "number") {
          sums[b] += v;
          any = true;
        }
      }
    }
    cache.set(key, any ? sums : (undefined as unknown as Record<Band, number>));
  }
  return cache.get(key);
}

function enumLabel(scope: RecordScope, fieldId: string): string | undefined {
  const el = scope.schema.elements.find((e) => e.id === fieldId);
  const id = enumIds(scope.values[fieldId])[0];
  return el?.typeParameters?.values?.find((v) => v.id === id)?.label;
}

/** The population limit for a target field, with a description of where it comes from. */
export function populationCap(el: FormElement, scope: RecordScope): { cap: number; group: string; area: string } | undefined {
  const bands = ruleFor(el, scope.schema.id)?.population;
  if (!bands) return undefined;
  const rows = scope.store.rows.get(POPULATION_FORM);
  const group = enumLabel(scope, TARGET_GROUP_FIELD);
  const area = enumLabel(scope, TARGET_AREA_FIELD);
  if (!rows || !group || !area) return undefined;
  const sums = populationSums(rows, group, area);
  if (!sums) return undefined;
  return { cap: bands.reduce((s, b) => s + sums[b], 0), group, area };
}

/** Whether one reference choice passes the portal's extra rule for that field (true when there is none). */
export function choiceAllowed(el: FormElement, scope: RecordScope, ref: string): boolean {
  const rule = ruleFor(el, scope.schema.id)?.choiceRule;
  if (!rule) return true;
  const r = tryEval(rule.formula, scope.with(el.id, el.type === "multiselectreference" ? [ref] : ref));
  return r === undefined || truthy(r);
}

function populationCombos(rows: FlatRow[], group: string, area: string) {
  return rows.some(
    (r) => r.settlement_for === group && (r.Upazila === area || r["camp.Upazila"] === area || r["camp.Camp"] === area),
  );
}

/**
 * Targets: population group and upazila must be a pair that exists in
 * PS_ref_blocks_population (there is no host community on Bhasan Char).
 * Returns the options to disable, with the reason.
 */
export function disabledOptions(el: FormElement, scope: RecordScope): Map<string, string> | undefined {
  if (scope.schema.id !== TARGETS || (el.id !== TARGET_GROUP_FIELD && el.id !== TARGET_AREA_FIELD)) return undefined;
  const rows = scope.store.rows.get(POPULATION_FORM);
  const otherField = el.id === TARGET_GROUP_FIELD ? TARGET_AREA_FIELD : TARGET_GROUP_FIELD;
  const other = enumLabel(scope, otherField);
  if (!rows?.length || !other) return undefined;
  const out = new Map<string, string>();
  for (const o of el.typeParameters?.values ?? []) {
    const [group, area] = el.id === TARGET_GROUP_FIELD ? [o.label, other] : [other, o.label];
    if (!populationCombos(rows, group, area)) out.set(o.id, `there is no ${group} population in ${area}`);
  }
  return out;
}

function monthName(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-GB", { month: "long", year: "numeric" });
}

const EMAIL =/^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const fmt = (n: number) => n.toLocaleString();

/** Returns a message when a non-empty value breaks one of the portal's rules. */
export function portalError(
  el: FormElement,
  value: unknown,
  scope: RecordScope,
  calc: (el: FormElement) => Val | undefined,
): string | undefined {
  const rule = ruleFor(el, scope.schema.id);
  if (rule?.hiddenOptions && enumIds(value).some((id) => rule.hiddenOptions!.includes(id))) {
    return "This choice is no longer used. Please pick another one.";
  }
  if (el.id === TARGET_AREA_FIELD) {
    const reason = disabledOptions(el, scope)?.get(enumIds(value)[0]);
    if (reason) return `Not possible: ${reason}. Choose another upazila or population group.`;
  }
  const max = maxLengthFor(el, scope.schema.id);
  if (max && typeof value === "string" && value.length > max) {
    return `Please shorten this to ${fmt(max)} characters or fewer (it has ${fmt(value.length)}).`;
  }
  if (!rule) return undefined;
  if (rule.email && typeof value === "string" && !EMAIL.test(value.trim())) {
    return "Please enter a valid email address, for example name@organization.org.";
  }
  if (rule.monthRange && typeof value === "string") {
    const { min, max, notBefore } = rule.monthRange;
    if (value < min || value > max) return `Please choose a month between ${monthName(min)} and ${monthName(max)}.`;
    const start = notBefore ? scope.values[notBefore] : undefined;
    if (typeof start === "string" && value < start) return `The end date cannot be before the start date (${monthName(start)}).`;
  }
  if (rule.choiceRule) {
    const bad = refList(value).filter((ref) => !choiceAllowed(el, scope, ref));
    if (bad.length) return `${rule.choiceRule.message}: ${bad.map((r) => refLabel(scope.store, r)).join("; ")}.`;
  }
  if (rule.minSelected && enumIds(value).length < rule.minSelected) {
    return `Please select at least ${rule.minSelected} options.`;
  }
  if (typeof value === "number") {
    if (rule.wholeNumber && (value < 0 || !Number.isInteger(value))) {
      return "Please enter a whole number (0 or greater). Decimal values are not allowed.";
    }
    const cap = populationCap(el, scope);
    if (cap && value > cap.cap) {
      return `This is more than the population in this area (${fmt(cap.cap)} for ${cap.group}, ${cap.area}).`;
    }
    if (rule.atMostField) {
      const totalEl = scope.schema.elements.find((e) => e.id === rule.atMostField);
      const total = totalEl ? calc(totalEl) : undefined;
      if (typeof total === "number" && value > total) {
        return `This cannot be more than the total individuals targeted (${fmt(total)}).`;
      }
    }
  }
  return undefined;
}

export function hiddenOptions(el: FormElement, formId: string): Set<string> {
  return new Set(ruleFor(el, formId)?.hiddenOptions ?? []);
}

/**
 * Activities saved with the old "Add multiple locations" method: turn their chosen
 * camps and blocks into 2.A-Locations rows and switch them to bulk upload. Changes are
 * only made in the form; they reach ActivityInfo when the user saves.
 */
export function migrateLocationMethod(root: RecordNode, store: FormStore): number {
  let converted = 0;
  const visit = (node: RecordNode) => {
    for (const rows of Object.values(node.subforms)) rows.forEach(visit);
    if (node.formId !== ACTIVITIES || !enumIds(node.fields[LOCATION_METHOD]).includes(METHOD_MULTIPLE)) return;
    const blocks = refList(node.fields[BLOCKS_MULTI]);
    const camps = refList(node.fields[CAMPS_MULTI]);
    const pairs: { camp: string; block?: string }[] = [];
    const campsWithBlocks = new Set<string>();
    for (const b of blocks) {
      const [, blockId] = splitRef(b);
      const campId = store.rowsById.get(POPULATION_FORM)?.get(blockId)?.["camp.@id"];
      if (typeof campId !== "string") continue;
      const camp = `${CAMPS_FORM}:${campId}`;
      campsWithBlocks.add(camp);
      pairs.push({ camp, block: b });
    }
    for (const c of camps) if (!campsWithBlocks.has(c)) pairs.push({ camp: c });
    const existing = node.subforms[LOCATIONS_SUBFORM] ?? [];
    node.subforms[LOCATIONS_SUBFORM] = [
      ...existing,
      ...pairs.map((p) => ({
        formId: LOCATIONS_FORM,
        recordId: generateRecordId(),
        fields: { [LOCATION_CAMP]: p.camp, ...(p.block ? { [LOCATION_BLOCK]: p.block } : {}) },
        subforms: {},
        isNew: true,
        dirty: true,
      })),
    ];
    node.fields = { ...node.fields, [LOCATION_METHOD]: METHOD_BULK };
    node.dirty = true;
    node.notice =
      `This activity used "Add multiple locations", which is no longer used. Its ${pairs.length} location` +
      `${pairs.length === 1 ? " was" : "s were"} moved into 2.A-Locations below. Please check them and save.`;
    converted++;
  };
  visit(root);
  return converted;
}
