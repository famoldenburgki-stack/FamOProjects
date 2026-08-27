/**
 * Einen Bescheid verarbeiten – gemeinsam genutzt vom Hochladen von Hand und vom
 * Bestätigen eines Bescheid-Entwurfs aus dem Eingang. Beide Wege müssen dasselbe
 * tun: Text auslesen, Positionen erkennen, Datei ablegen, Datensatz schreiben,
 * den Einreichungen zuordnen und gegen die erwartete Erstattung prüfen.
 */
import path from 'node:path';
import { db } from './db.js';
import { archiveDecisionFile, getArchiveRoot, resolveStoredPath } from './archive.js';
import { extractText } from './ocr/extract.js';
import { hasWord, parseDecision } from './ocr/parse.js';
import { openSubmissionsFor, processDecision, type ProcessResult } from './decisionEngine.js';
import type { Target } from './types.js';

export interface DecisionInput {
  /** Pfad der Datei – absolut oder relativ zum Backend-Ordner. */
  filePath: string;
  originalName: string;
  /** Vom Nutzer gewählter Absender; leer = aus dem Dokument bestimmen. */
  targetInput?: string;
  account?: string;
  /** Bereits ausgelesener Text, falls er schon vorliegt (Eingang). */
  text?: string;
  ocrSource?: string;
  ocrWarning?: string;
}

/**
 * Zugang aus dem Dokument bestimmen. Bescheide gehen an die beihilfeberechtigte
 * bzw. versicherte Person, und die steht im Anschriftenfeld oben – deshalb zählt
 * der Kopf des Dokuments zuerst. Weiter unten stehen die Namen der behandelten
 * Kinder, die den Zugang gerade nicht bestimmen.
 */
export function guessAccount(text: string): { account: string; confident: boolean } {
  const konten = [
    ...new Set(
      (
        db
          .prepare('SELECT account FROM family_members WHERE active = 1 ORDER BY sort_order')
          .all() as { account: string }[]
      ).map((r) => r.account),
    ),
  ];
  // Ohne angelegte Personen gibt es keinen Zugang, den man raten könnte.
  if (konten.length === 0) return { account: '', confident: false };
  if (konten.length === 1) return { account: konten[0], confident: true };

  const kopf = text.split(/\r?\n/).slice(0, 25).join('\n');
  const imKopf = konten.filter((k) => hasWord(kopf, k));
  // Nur eindeutig, wenn genau ein Zugang im Anschriftenfeld steht.
  if (imKopf.length === 1) return { account: imKopf[0], confident: true };

  const imText = konten.filter((k) => hasWord(text, k));
  if (imText.length === 1) return { account: imText[0], confident: false };
  return { account: konten[0], confident: false };
}

export type DecisionOutcome =
  | { ok: false; error: string; needs_choice?: boolean; suggestion?: { account: string } }
  | {
      ok: true;
      result: ProcessResult;
      ocr_source: string;
      options: ReturnType<typeof openSubmissionsFor>;
      /** Wurden Absender bzw. Zugang selbst bestimmt statt vorgegeben? */
      detected: { target: boolean; account: boolean };
    };

/** Absender und Bescheiddatum bestimmen, ohne etwas zu speichern. */
export async function readDecision(
  filePath: string,
  vorhandenerText?: string,
): Promise<{ text: string; source: string; warning?: string; parsed: Awaited<ReturnType<typeof parseDecision>> }> {
  const memberNames = (
    db.prepare('SELECT name FROM family_members ORDER BY sort_order').all() as { name: string }[]
  ).map((r) => r.name);

  if (vorhandenerText) {
    return {
      text: vorhandenerText,
      source: 'zwischengespeichert',
      parsed: await parseDecision(vorhandenerText, memberNames),
    };
  }
  /*
   * Gespeicherte Pfade sind relativ zum Backend-Ordner – aufgelöst werden muss
   * hier, sonst liest die Texterkennung ins Leere und der Bescheid käme ohne
   * erkannten Absender und ohne Positionen durch.
   */
  const { text, source, warning } = await extractText(resolveStoredPath(filePath));
  return { text, source, warning, parsed: await parseDecision(text, memberNames) };
}

export async function createDecision(input: DecisionInput): Promise<DecisionOutcome> {
  const targetInput = (input.targetInput ?? '').toLowerCase();
  const { text, source, warning, parsed } = await readDecision(input.filePath, input.text);

  /*
   * Ohne Text gibt es nichts zu prüfen. Das lieber laut abbrechen, als einen
   * Bescheid ohne Positionen zu speichern – der sähe hinterher aus wie ein
   * Bescheid, aus dem nichts zu erstatten war.
   */
  if (text.trim().length < 100) {
    return {
      ok: false,
      error:
        'Aus dem Dokument ließ sich kaum Text gewinnen – es wurde nichts gespeichert. ' +
        'Bei Fotos hilft eine gerade, gut ausgeleuchtete Aufnahme; ein PDF aus dem Portal ist besser.',
    };
  }

  const target: Target | null =
    targetInput === 'dbv' || targetInput === 'beihilfe' ? targetInput : parsed.target_hint;
  if (!target) {
    /*
     * Nur hier braucht es eine Nachfrage: das Dokument gibt den Absender nicht
     * her. Im Normalfall erkennt die Formaterkennung ihn, und niemand muss
     * etwas auswählen.
     */
    return {
      ok: false,
      error:
        'Der Absender war im Dokument nicht erkennbar. Bitte einmal angeben, ob der Bescheid ' +
        'von der Beihilfe oder von der DBV kommt.',
      needs_choice: true,
      suggestion: { account: guessAccount(text).account },
    };
  }

  const warnings: string[] = [];
  if (input.ocrWarning) warnings.push(input.ocrWarning);
  if (warning) warnings.push(warning);
  if (!targetInput && parsed.target_hint) {
    warnings.push(`Absender automatisch als "${parsed.target_hint.toUpperCase()}" erkannt.`);
  }
  /*
   * Widerspricht das Dokument der Auswahl, wird nichts automatisch übernommen.
   * Eine als Beihilfe eingelesene DBV-Abrechnung schreibt sonst den DBV-Anteil in
   * die Beihilfe-Einreichung – der Fehler ist aus den Zahlen später kaum zu sehen.
   */
  const absenderWiderspruch = Boolean(
    targetInput && parsed.target_hint && parsed.target_hint !== targetInput,
  );
  if (absenderWiderspruch) {
    warnings.push(
      `Nichts übernommen: Du hast "${targetInput.toUpperCase()}" gewählt, das Dokument ist aber eindeutig von "${parsed.target_hint!.toUpperCase()}". ` +
        `Der Bescheid wurde nur erfasst. Bitte mit dem richtigen Absender erneut einlesen.`,
    );
  }
  warnings.push(...(parsed.notes ?? []));
  if (parsed.format === 'generisch') {
    warnings.push(
      'Das Bescheidformat ist unbekannt – die Positionen wurden über allgemeine Regeln erkannt. Bitte die Zuordnung besonders sorgfältig prüfen.',
    );
  }
  if (
    parsed.payout_amount !== null &&
    parsed.payout_amount !== undefined &&
    parsed.total_paid !== null &&
    Math.abs(parsed.payout_amount - parsed.total_paid) > 0.02
  ) {
    warnings.push(
      `Überwiesen werden ${parsed.payout_amount.toFixed(2)} € statt der ausgewiesenen ${parsed.total_paid.toFixed(2)} € Erstattung – der Bescheid enthält eine Verrechnung.`,
    );
  }

  /*
   * Den Bescheid in die Ablage verschieben, bevor der Datensatz entsteht – dann
   * steht in der Datenbank gleich der endgültige Pfad.
   */
  /*
   * Zugang: nur nehmen, was ausdrücklich mitgegeben wurde – sonst aus dem
   * Dokument bestimmen. Über den Zugang läuft die Zuordnung der Positionen, ein
   * falscher Zugang findet die Rechnungen der anderen Person nicht.
   */
  const vorgegeben = (input.account ?? '').trim();
  const geraten = vorgegeben ? null : guessAccount(text);
  const zugang = vorgegeben || geraten?.account || '';
  if (geraten && !geraten.confident) {
    warnings.push(
      `Der Zugang war nicht eindeutig – angenommen wurde "${zugang}". Falls das nicht stimmt, ` +
        'bitte den Bescheid löschen und mit dem richtigen Zugang erneut einlesen.',
    );
  }
  const zugangsMitglied = db
    .prepare('SELECT sort_order FROM family_members WHERE name = ?')
    .get(zugang) as { sort_order: number } | undefined;

  let filePath = input.filePath;
  const abgelegt = archiveDecisionFile(filePath, {
    account: zugang,
    accountOrder: zugangsMitglied?.sort_order ?? 0,
    target,
    decisionDate: parsed.decision_date,
    totalPaid: parsed.total_paid,
    extension: path.extname(input.originalName).toLowerCase() || '.pdf',
  });
  filePath = abgelegt.path;
  if (!abgelegt.archived && abgelegt.reason && getArchiveRoot()) {
    warnings.push(`Die Datei konnte nicht in die Ablage verschoben werden: ${abgelegt.reason}`);
  }

  const result = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO decisions (target, account, decision_date, file_path, ocr_text, total_paid)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(target, zugang, parsed.decision_date, filePath, text.slice(0, 200_000), parsed.total_paid);
    return processDecision(
      Number(info.lastInsertRowid),
      target,
      zugang,
      parsed.items,
      parsed.decision_date,
      parsed.total_paid,
      warnings,
      { apply: !absenderWiderspruch },
    );
  });

  return {
    ok: true,
    result,
    ocr_source: input.ocrSource ?? source,
    options: openSubmissionsFor(target, zugang || null),
    detected: { target: !targetInput, account: !vorgegeben },
  };
}
