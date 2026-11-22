import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  saveStudentImport,
  validateStudentImport,
  type ImportProblem,
  type ImportSaveResult,
} from "@/api/client";

const CHUNK_SIZE = 200;

function chunkRows<T>(rows: T[]): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    chunks.push(rows.slice(i, i + CHUNK_SIZE));
  }
  return chunks;
}

const REQUIRED_HEADERS = [
  "firstName",
  "lastName",
  "admissionNumber",
  "className",
] as const;

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const nonEmpty = records.filter((row) => row.some((cell) => cell.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };
  const headers = nonEmpty[0]!.map((header) => header.trim());
  const rows = nonEmpty.slice(1).map((values) => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = (values[index] ?? "").trim();
    });
    return row;
  });
  return { headers, rows };
}

export function StudentImportPage() {
  const [csv, setCsv] = useState("");
  const [problems, setProblems] = useState<ImportProblem[] | null>(null);
  const [result, setResult] = useState<ImportSaveResult | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const parsed = parseCsv(csv);
  const chunks = chunkRows(parsed.rows);
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !parsed.headers.includes(header));
  const canProcess = parsed.rows.length > 0 && missingHeaders.length === 0;

  const validate = useMutation({
    mutationFn: async () => {
      const problems: ImportProblem[] = [];
      for (let index = 0; index < chunks.length; index += 1) {
        const offset = index * CHUNK_SIZE;
        const result = await validateStudentImport(chunks[index]!);
        problems.push(
          ...result.problems.map((problem) => ({
            ...problem,
            row: problem.row + offset,
          })),
        );
      }
      return problems;
    },
    onSuccess: (allProblems) => {
      setProblems(allProblems);
      setBanner(
        allProblems.length === 0
          ? `All ${parsed.rows.length} rows are valid across ${chunks.length} chunk${chunks.length === 1 ? "" : "s"}.`
          : null,
      );
    },
    onError: (error) => setBanner(error instanceof Error ? error.message : "Validation failed."),
  });

  const save = useMutation({
    mutationFn: async () => {
      // Validate every chunk first so we never start writing a file that has
      // a known error later in it.
      const allProblems: ImportProblem[] = [];
      for (let index = 0; index < chunks.length; index += 1) {
        const offset = index * CHUNK_SIZE;
        const result = await validateStudentImport(chunks[index]!);
        allProblems.push(
          ...result.problems.map((problem) => ({
            ...problem,
            row: problem.row + offset,
          })),
        );
      }
      if (allProblems.length > 0) {
        return {
          result: null as ImportSaveResult | null,
          problems: allProblems,
          partial: false,
        };
      }

      let created = 0;
      const credentials: ImportSaveResult["credentials"] = [];
      for (let index = 0; index < chunks.length; index += 1) {
        const offset = index * CHUNK_SIZE;
        try {
          const result = await saveStudentImport(chunks[index]!);
          if (!result.valid) {
            return {
              result: null as ImportSaveResult | null,
              problems: result.problems.map((problem) => ({
                ...problem,
                row: problem.row + offset,
              })),
              partial: created > 0,
            };
          }
          created += result.created;
          credentials.push(
            ...result.credentials.map((credential) => ({
              ...credential,
              row: credential.row + offset,
            })),
          );
        } catch (error) {
          return {
            result: partialResult(created, credentials),
            problems: [],
            partial: true,
            error: error instanceof Error ? error.message : "Import failed.",
          };
        }
      }
      return {
        result: {
          valid: true,
          problems: [],
          created,
          credentials,
        } satisfies ImportSaveResult,
        problems: [],
        partial: false,
      };
    },
    onSuccess: (outcome) => {
      setProblems(outcome.problems);
      if (outcome.result) {
        setResult(outcome.result);
        setBanner(
          outcome.partial
            ? `Imported ${outcome.result.created} students, then a later chunk failed. Earlier chunks were saved.`
            : `Imported ${outcome.result.created} students.`,
        );
      } else {
        setResult(null);
        setBanner("Import was not saved because validation failed.");
      }
    },
    onError: (error) => setBanner(error instanceof Error ? error.message : "Import failed."),
  });

  function partialResult(
    created: number,
    credentials: ImportSaveResult["credentials"],
  ): ImportSaveResult {
    return { valid: true, problems: [], created, credentials };
  }

  function downloadTemplate() {
    const template =
      "firstName,lastName,email,username,admissionNumber,className\n" +
      "Ada,Okafor,ada@school.test,,ADM-001,JSS 1 A\n";
    const url = URL.createObjectURL(
      new Blob([template], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "student-import-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function loadFile(file: File) {
    setCsv(await file.text());
    setProblems(null);
    setResult(null);
    setBanner(null);
  }

  return (
    <div className="mx-auto max-w-[1040px]">
      <h1 className="text-[24px] font-semibold leading-8 text-[var(--text)]">Student Import</h1>
      <p className="mt-2 text-[14px] leading-[18px] text-[var(--muted)]">
        Paste or upload CSV. The browser parses the file; the server validates JSON rows and returns every problem with a row number.
      </p>

      {banner && (
        <div className={`mt-4 rounded-md border px-4 py-3 text-[14px] leading-[18px] ${result?.valid ? "border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]" : "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]"}`}>
          {banner}
        </div>
      )}

      <div className="mt-6 rounded-md border border-[var(--border)] bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold">CSV rows</h2>
            <p className="mt-1 text-[12px] text-[var(--muted)]">
              Required headers: firstName, lastName, admissionNumber, className. Include email or username for login.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={downloadTemplate}
              className="inline-flex h-9 items-center rounded-md border border-[var(--border-strong)] bg-white px-4 text-[14px] font-medium hover:bg-[var(--bg)]"
            >
              Download template
            </button>
            <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-[var(--border-strong)] bg-white px-4 text-[14px] font-medium hover:bg-[var(--bg)]">
              Choose file
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (file) void loadFile(file); }} />
            </label>
          </div>
        </div>

        <textarea
          value={csv}
          onChange={(e) => { setCsv(e.target.value); setProblems(null); setResult(null); }}
          rows={8}
          placeholder={"firstName,lastName,email,username,admissionNumber,className\nAda,Okafor,ada@school.test,,ADM-001,JSS 1 A"}
          className="mt-3 w-full rounded-md border border-[var(--border-strong)] bg-white p-3 font-mono text-[12px] leading-5 outline-none focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
        />

        <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-[var(--muted)]">
          <span>{parsed.rows.length} rows</span>
          {missingHeaders.length > 0 && <span className="text-[#B91C1C]">Missing headers: {missingHeaders.join(", ")}</span>}
          {chunks.length > 1 && <span>{chunks.length} chunks of up to {CHUNK_SIZE} rows</span>}
        </div>

        {parsed.rows.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded border border-[var(--border)]">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-[var(--surface-muted)] text-[var(--muted)]">
                <tr>{parsed.headers.map((header) => <th key={header} className="px-3 py-2 font-medium">{header}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {parsed.rows.slice(0, 5).map((row, index) => (
                  <tr key={index}>{parsed.headers.map((header) => <td key={header} className="px-3 py-2">{row[header]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={!canProcess || validate.isPending} onClick={() => { setResult(null); validate.mutate(); }} className="h-9 rounded-md border border-[var(--border-strong)] bg-white px-4 text-[14px] font-medium disabled:opacity-60">
            {validate.isPending ? "Validating..." : "Validate all"}
          </button>
          <button type="button" disabled={!canProcess || save.isPending} onClick={() => save.mutate()} className="h-9 rounded-md bg-[var(--accent)] px-4 text-[14px] font-medium text-white disabled:opacity-60">
            {save.isPending ? "Importing..." : "Import students"}
          </button>
        </div>
      </div>

      {problems && problems.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-md border border-[#FECACA] bg-white">
          <div className="border-b border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-[14px] font-medium text-[#B91C1C]">
            {problems.length} problem{problems.length === 1 ? "" : "s"} found
          </div>
          <div className="divide-y divide-[var(--border)]">
            {problems.map((problem, index) => (
              <div key={`${problem.row}-${problem.field}-${index}`} className="flex flex-col gap-1 px-4 py-3 text-[14px] sm:flex-row sm:items-center sm:justify-between">
                <span className="font-medium">Row {problem.row} · {problem.field}</span>
                <span className="text-[var(--muted)]">{problem.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result && result.credentials.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-md border border-[var(--border)] bg-white">
          <div className="border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
            <p className="text-[14px] font-semibold text-[var(--text)]">One-time credentials</p>
            <p className="mt-1 text-[12px] text-[#B45309]">These passwords are shown once. Share them securely.</p>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {result.credentials.map((credential) => (
              <div key={credential.studentId} className="flex flex-col gap-1 px-4 py-3 text-[14px] sm:flex-row sm:items-center sm:justify-between">
                <span>Row {credential.row}</span>
                <code className="rounded bg-[var(--bg)] px-2 py-1 text-[13px]">{credential.temporaryPassword}</code>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
