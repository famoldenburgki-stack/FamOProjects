/**
 * Parser für die konkreten Bescheidformate, die tatsächlich eintreffen.
 *
 * Beide echten Formate sind Tabellen und enthalten – anders als zunächst
 * angenommen – **keine Rechnungsnummer des Arztes**. Zugeordnet wird deshalb
 * über Patient, Betrag und Datum bzw. Behandlungsjahr.
 *
 * Beihilfe Hessen (Regierungspräsidium Kassel):
 *   Beleg-Nr | Patient | Leistungsart | Belegdatum | RE-Betrag |
 *   beihilfefähiger Betrag | Bemessungssatz | Beihilfebetrag
 *   Eine Kürzung zeigt sich daran, dass der beihilfefähige Betrag unter dem
 *   Rechnungsbetrag liegt.
 *
 * DBV (Leistungsabrechnung):
 *   Abschnitt pro Patient, darin Zeilen mit
 *   Name/Leistung | Tarif | Behandlungsjahr | Rechnungsbetrag |
 *   Ablehnungsbetrag | Erstattungsbetrag | Anmerkung-Nr.
 *   Die Anmerkungen am Ende enthalten die ausführliche Begründung.
 */
import {
  detectReasons,
  num,
  toIsoDate,
  toLines,
  type DecisionItemSuggestion,
  type DecisionSuggestion,
} from './parse.js';

const AMOUNT = String.raw`[\d.]*\d,\d{2}`;
const DATE = String.raw`\d{1,2}\.\d{1,2}\.\d{4}`;

export function detectDecisionFormat(text: string): DecisionSuggestion['format'] {
  if (/HBeihVO|Hessischen Beihilfenverordnung|Anlage zum Beihilfebescheid|Beihilfebescheid/i.test(text)) {
    return 'beihilfe-hessen';
  }
  if (/DBV Deutsche Beamtenversicherung|Leistungsabrechnung|AXA Krankenversicherung/i.test(text)) {
    return 'dbv';
  }
  return 'generisch';
}

/** Sucht in einem Zeilenfenster den Namen eines Familienmitglieds. */
function findMember(lines: string[], center: number, memberNames: string[]): string | null {
  for (const offset of [1, -1, 2, -2, 0]) {
    const line = lines[center + offset];
    if (!line) continue;
    for (const name of memberNames) {
      if (new RegExp(`\\b${name}\\b`, 'i').test(line)) return name;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Beihilfe Hessen                                                    */
/* ------------------------------------------------------------------ */

/*
 * Zwei Tabellenlayouts kommen vor. Im neueren steht der Patient in einer eigenen,
 * umbrochenen Zelle über und unter der Zahlenzeile; im älteren steht er direkt
 * hinter der Belegnummer in derselben Zeile.
 */
const BEIHILFE_ROW = new RegExp(
  String.raw`^(\d{3})\s+(${DATE})\s+(${AMOUNT})\s*€\s+(${AMOUNT})\s*€\s+(\d{1,3},\d{2})\s*%\s+(${AMOUNT})\s*€`,
);

const BEIHILFE_ROW_INLINE = new RegExp(
  String.raw`^(\d{3})\s+(.{3,60}?)\s+(${DATE})\s+(${AMOUNT})\s*€\s+(${AMOUNT})\s*€\s+(\d{1,3},\d{2})\s*%\s+(${AMOUNT})\s*€`,
);

export function parseBeihilfeHessen(text: string, memberNames: string[]): DecisionSuggestion {
  const lines = toLines(text);
  const items: DecisionItemSuggestion[] = [];
  const notes: string[] = [];

  lines.forEach((line, i) => {
    const neu = BEIHILFE_ROW.exec(line);
    const alt = neu ? null : BEIHILFE_ROW_INLINE.exec(line);
    if (!neu && !alt) return;

    // Im älteren Layout steht zwischen Belegnummer und Datum "Nachname, Vorname Leistungsart".
    const inlineText = alt ? alt[2] : '';
    const m = neu ?? [alt![1], alt![1], alt![3], alt![4], alt![5], alt![6], alt![7]];
    const [, belegNr, belegDatum, reBetrag, beihilfefaehig, satz, beihilfeBetrag] = m as string[];

    const invoiceAmount = num(reBetrag);
    const eligible = num(beihilfefaehig);
    const rejected = Math.round((invoiceAmount - eligible) * 100) / 100;

    const reasons: string[] = [];
    if (rejected > 0.005) {
      reasons.push('Nicht beihilfefähiger Anteil');
      reasons.push(...detectReasons(line));
    }

    items.push({
      // Die Beleg-Nr. gilt nur innerhalb dieses Antrags, sie ist keine Rechnungsnummer.
      invoice_number: '',
      invoice_date: toIsoDate(belegDatum),
      invoice_amount: invoiceAmount,
      paid_amount: num(beihilfeBetrag),
      rejected_amount: rejected > 0.005 ? rejected : null,
      rate: num(satz) / 100,
      member_name: inlineText
        ? (memberNames.find((n) => new RegExp(`\\b${n}\\b`, 'i').test(inlineText)) ?? null)
        : findMember(lines, i, memberNames),
      service_label: inlineText
        ? inlineText.replace(/^\S+,\s*\S+\s*/, '').trim() || inlineText
        : serviceLabel(lines, i, memberNames),
      reason: [...new Set(reasons)].join('; '),
      raw_line: `Beleg ${belegNr}: ${line}`,
    });
  });

  const summen = matchLine(lines, new RegExp(String.raw`^Summen\s+(${AMOUNT})\s*€\s+(${AMOUNT})\s*€\s+(${AMOUNT})\s*€`));
  const payout = matchLine(lines, new RegExp(String.raw`^Auszahlungsbetrag\s+(${AMOUNT})\s*€`));
  const alreadyPaid = matchLine(lines, new RegExp(String.raw`^Abz[üu]glich bereits gezahlt\s+(${AMOUNT})\s*€`));

  if (alreadyPaid && num(alreadyPaid[1]) > 0.005) {
    notes.push(
      `Der Bescheid verrechnet ${alreadyPaid[1]} € bereits gezahlte Beihilfe – der überwiesene Betrag ist deshalb niedriger als die Summe der Positionen.`,
    );
  }

  return {
    decision_date:
      firstDate(lines, /Beihilfebescheid vom/i) ??
      firstDate(lines, /^Datum\b/i) ??
      null,
    total_paid: summen ? num(summen[3]) : null,
    payout_amount: payout ? num(payout[1]) : null,
    items,
    detected_account_hint: null,
    target_hint: 'beihilfe',
    format: 'beihilfe-hessen',
    notes,
  };
}

/**
 * Die Leistungsart steht in einer umbrochenen Tabellenzelle über und unter der
 * Zahlenzeile ("Ambulante" / "Arztrechnung", "Zahnarztrechnun" / "g").
 */
function serviceLabel(lines: string[], i: number, memberNames: string[]): string {
  const before = (lines[i - 1] ?? '').replace(/^\S+,\s*/, '').trim();
  let after = (lines[i + 1] ?? '').trim();
  for (const name of memberNames) {
    after = after.replace(new RegExp(`\\b${name}\\b`, 'i'), '').trim();
  }
  if (!before) return after;
  if (!after) return before;
  // Sehr kurze Fortsetzungen sind abgetrennte Wortenden ("g" von "…rechnung").
  return after.length <= 2 ? `${before}${after}` : `${before} ${after}`;
}

/* ------------------------------------------------------------------ */
/*  DBV                                                                */
/* ------------------------------------------------------------------ */

const DBV_ROW = new RegExp(
  String.raw`^(.+?)\s+(\d{4})\s+(${AMOUNT})(?:\s+(${AMOUNT}))?(?:\s+(\d{1,2}))?$`,
);

const DBV_SKIP = /^(Name\/Leistung|KOSTENBELEGE|Erstattungsbetrag|Auszahlungsbetrag|Jahr\b|Anmerkung)/i;

export function parseDbv(text: string, memberNames: string[]): DecisionSuggestion {
  const lines = toLines(text);
  const noteTexts = collectDbvNotes(lines);
  const items: DecisionItemSuggestion[] = [];

  let currentMember: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    /* Abschnittskopf: "Ina Musterl, 14.06.2018" */
    const section = matchMemberSection(line, memberNames);
    if (section) {
      currentMember = section;
      continue;
    }
    if (DBV_SKIP.test(line)) continue;

    const m = DBV_ROW.exec(line);
    if (!m) continue;
    const [, rawLabel, year, a1, a2, noteRef] = m;

    const label = rawLabel.trim();
    const isTotalRow = /\bgesamt\b/i.test(label);
    const invoiceAmount = num(a1);

    let paid: number | null = null;
    let rejected: number | null = null;
    let consumed = i;

    if (isTotalRow) {
      // Summenzeile einer Rechnung: zweiter Betrag ist der Ablehnungsbetrag.
      rejected = a2 ? num(a2) : null;
      // Die Erstattung steht in den folgenden Detailzeilen derselben Leistung.
      const prefix = label.replace(/\bgesamt\b/i, '').trim().split(' ')[0];
      let sum = 0;
      let found = false;
      for (let j = i + 1; j < lines.length; j++) {
        const det = DBV_ROW.exec(lines[j]);
        if (!det || !det[1].toLowerCase().startsWith(prefix.toLowerCase())) break;
        const detAmounts = [det[3], det[4]].filter(Boolean) as string[];
        sum += num(detAmounts[detAmounts.length - 1]);
        found = true;
        consumed = j;
      }
      paid = found ? Math.round(sum * 100) / 100 : null;
    } else {
      paid = a2 ? num(a2) : null;
    }

    const noteText = noteRef ? (noteTexts.get(noteRef) ?? '') : '';
    const reasons = rejected && rejected > 0.005 ? ['Teilbetrag abgelehnt'] : [];
    reasons.push(...detectReasons(noteText));

    items.push({
      invoice_number: '',
      invoice_date: null,
      invoice_amount: invoiceAmount,
      paid_amount: paid,
      rejected_amount: rejected,
      rate: null,
      treatment_year: Number(year),
      member_name: currentMember,
      service_label: stripTariff(label),
      reason: [...new Set(reasons)].join('; '),
      raw_line: [line, noteText && `Anmerkung ${noteRef}: ${noteText}`].filter(Boolean).join('\n').slice(0, 1500),
    });

    i = consumed;
  }

  const totalPaid = matchLine(lines, new RegExp(String.raw`^Erstattungsbetrag gesamt\s+(${AMOUNT})$`));
  const payout = matchLine(lines, new RegExp(String.raw`^Auszahlungsbetrag(?:\s+gesamt)?:?\s+(${AMOUNT})`));

  return {
    decision_date: firstDate(lines, /Schreiben vom/i) ?? firstDate(lines, /Seite 1 von/i) ?? null,
    total_paid: totalPaid ? num(totalPaid[1]) : null,
    payout_amount: payout ? num(payout[1]) : null,
    items,
    detected_account_hint: null,
    target_hint: 'dbv',
    format: 'dbv',
    notes: [],
  };
}

/** "Ina Musterl, 14.06.2018" -> "Ina" */
function matchMemberSection(line: string, memberNames: string[]): string | null {
  const m = new RegExp(String.raw`^(\S+)\s+\S+,\s*${DATE}$`).exec(line);
  if (!m) return null;
  const first = m[1];
  return memberNames.find((n) => n.toLowerCase() === first.toLowerCase()) ?? null;
}

/** Tarifkürzel wie "VisB3520-N" aus der Leistungsbezeichnung entfernen. */
function stripTariff(label: string): string {
  return label
    .replace(/\b[A-Za-z]{2,}\d{3,}(-[A-Za-z0-9]+)?\b/g, '')
    .replace(/\bgesamt\b/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Die ausführlichen Begründungen am Ende der DBV-Abrechnung einsammeln. */
function collectDbvNotes(lines: string[]): Map<string, string> {
  const notes = new Map<string, string>();
  const isFooter = (l: string) =>
    /^(DBV Deutsche Beamtenversicherung|Abraham-Lincoln-Park|Sitz der Gesellschaft|Vorsitzender des Aufsichtsrats|Freundlich gr[üu]|Ihre DBV|Zweigniederlassung|Krankenversicherung$|Schreiben vom|Seite \d)/i.test(
      l,
    );

  for (let i = 0; i < lines.length; i++) {
    const head = /^Anmerkung\s+(\d{1,2})$/.exec(lines[i]);
    if (!head) continue;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (/^Anmerkung\s+\d{1,2}$/.test(lines[j]) || isFooter(lines[j])) break;
      body.push(lines[j]);
    }
    notes.set(head[1], body.join(' ').trim());
  }
  return notes;
}

/* ------------------------------------------------------------------ */
/*  Hilfsfunktionen                                                    */
/* ------------------------------------------------------------------ */

function matchLine(lines: string[], re: RegExp): RegExpExecArray | null {
  for (const line of lines) {
    const m = re.exec(line);
    if (m) return m;
  }
  return null;
}

function firstDate(lines: string[], marker: RegExp): string | null {
  for (const line of lines) {
    if (!marker.test(line)) continue;
    const m = new RegExp(DATE).exec(line);
    if (m) return toIsoDate(m[0]);
  }
  return null;
}
