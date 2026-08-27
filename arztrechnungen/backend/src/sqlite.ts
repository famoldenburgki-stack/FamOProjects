import { DatabaseSync } from 'node:sqlite';

/**
 * Dünne Hülle um das in Node eingebaute SQLite (`node:sqlite`).
 * Bewusst ohne native Zusatzpakete – so läuft das Backend nach einem einfachen
 * `npm install` ohne Compiler-Toolchain auf dem Rechner.
 */

export type SqlValue = string | number | bigint | null | Uint8Array;

export interface RunResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

export interface Statement {
  run(...params: unknown[]): RunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export class Db {
  private readonly handle: DatabaseSync;

  constructor(file: string) {
    this.handle = new DatabaseSync(file);
  }

  exec(sql: string): void {
    this.handle.exec(sql);
  }

  /** Schließt die Datei – nötig, damit Prüfläufe ihre Testdatenbank löschen können. */
  close(): void {
    this.handle.close();
  }

  prepare(sql: string): Statement {
    const stmt = this.handle.prepare(sql);
    const coerce = (params: unknown[]): SqlValue[] =>
      params.map((p) => {
        if (p === undefined) return null;
        if (typeof p === 'boolean') return p ? 1 : 0;
        return p as SqlValue;
      });
    return {
      run: (...params) => stmt.run(...coerce(params)) as RunResult,
      get: (...params) => stmt.get(...coerce(params)),
      all: (...params) => stmt.all(...coerce(params)),
    };
  }

  /** Führt fn in einer Transaktion aus und rollt bei Fehlern zurück. */
  transaction<T>(fn: () => T): T {
    this.handle.exec('BEGIN');
    try {
      const result = fn();
      this.handle.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        this.handle.exec('ROLLBACK');
      } catch {
        /* Transaktion war bereits beendet */
      }
      throw err;
    }
  }
}
