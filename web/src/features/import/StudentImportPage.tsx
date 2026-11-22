import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  saveStudentImport,
  validateStudentImport,
  type ImportProblem,
  type ImportSaveResult,
} from "@/api/client";

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
  const missingHeaders = REQUIRED_HEADERS.filter((header) => !parsed.headers.includes(header));
  const canProcess = parsed.rows.length > 0 && missingHeaders.length === 0 && parsed.rows.length <= 200;

  const validate = useMutation({
    mutationFn: () => validateStudentImport(parsed.rows),
    onSuccess: (data) => {
      setProblems(data.problems);
      setBanner(data.valid ? "All rows are valid. You can import." : null);
    },
    onError: (error) => setBanner(error instanceof Error ? error.message : "Validation failed."),
  });

  const save = useMutation({
    mutationFn: () => saveStudentImport(parsed.rows),
    onSuccess: (data) => {
      setResult(data);
      setProblems(data.problems);
      setBanner(data.valid ? "Import completed." : "Import was not saved because validation failed.");
    },
    onError: (error) => setBanner(error instanceof Error ? error.message : "Import failed."),
  });

  async function loadFile(file: File) {
    setCsv(await file.text());
    setProblems(null);
    setResult(null);
    setBanner(null);
  }

  return (
    <div className="mx-auto max-w-[1040px]">
      <h1 className="text-[24px] font-semibold leading-8 text-[#18181B]">Student Import</h1>
      <p className="mt-2 text-[14px] leading-[18px] text-[#71717A]">
        Paste or upload CSV. The browser parses the file; the server validates JSON rows and returns every problem with a row number.
      </p>

      {banner && (
        <div className={`mt-4 rounded-md border px-4 py-3 text-[14px] leading-[18px] ${result?.valid ? "border-[#BBF7D0] bg-[#F0FDF4] text-[#15803D]" : "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]"}`}>
          {banner}
        </div>
      )}

      <div className="mt-6 rounded-md border border-[#E4E4E7] bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-semibold">CSV rows</h2>
            <p className="mt-1 text-[12px] text-[#71717A]">
              Required headers: firstName, lastName, admissionNumber, className. Include email or username for login.
            </p>
          </div>
          <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-[#D1D5DB] bg-white px-4 text-[14px] font-medium hover:bg-[#F4F4F5]">
            Choose file
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (file) void loadFile(file); }} />
          </label>
        </div>

        <textarea
          value={csv}
          onChange={(e) => { setCsv(e.target.value); setProblems(null); setResult(null); }}
          rows={8}
          placeholder={"firstName,lastName,email,username,admissionNumber,className\nAda,Okafor,ada@school.test,,ADM-001,JSS 1 A"}
          className="mt-3 w-full rounded-md border border-[#D1D5DB] bg-white p-3 font-mono text-[12px] leading-5 outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#2563EB]/20"
        />

        <div className="mt-3 flex flex-wrap items-center gap-3 text-[12px] text-[#71717A]">
          <span>{parsed.rows.length} rows</span>
          {missingHeaders.length > 0 && <span className="text-[#B91C1C]">Missing headers: {missingHeaders.join(", ")}</span>}
          {parsed.rows.length > 200 && <span className="text-[#B91C1C]">A request may import at most 200 rows.</span>}
        </div>

        {parsed.rows.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded border border-[#E4E4E7]">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-[#FAFAFA] text-[#71717A]">
                <tr>{parsed.headers.map((header) => <th key={header} className="px-3 py-2 font-medium">{header}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-[#E4E4E7]">
                {parsed.rows.slice(0, 5).map((row, index) => (
                  <tr key={index}>{parsed.headers.map((header) => <td key={header} className="px-3 py-2">{row[header]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" disabled={!canProcess || validate.isPending} onClick={() => { setResult(null); validate.mutate(); }} className="h-9 rounded-md border border-[#D1D5DB] bg-white px-4 text-[14px] font-medium disabled:opacity-60">
            {validate.isPending ? "Validating..." : "Validate"}
          </button>
          <button type="button" disabled={!canProcess || save.isPending || (problems !== null && problems.length > 0)} onClick={() => save.mutate()} className="h-9 rounded-md bg-[#2563EB] px-4 text-[14px] font-medium text-white disabled:opacity-60">
            {save.isPending ? "Importing..." : "Import students"}
          </button>
        </div>
      </div>

      {problems && problems.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-md border border-[#FECACA] bg-white">
          <div className="border-b border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-[14px] font-medium text-[#B91C1C]">
            {problems.length} problem{problems.length === 1 ? "" : "s"} found
          </div>
          <div className="divide-y divide-[#E4E4E7]">
            {problems.map((problem, index) => (
              <div key={`${problem.row}-${problem.field}-${index}`} className="flex flex-col gap-1 px-4 py-3 text-[14px] sm:flex-row sm:items-center sm:justify-between">
                <span className="font-medium">Row {problem.row} · {problem.field}</span>
                <span className="text-[#71717A]">{problem.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result && result.credentials.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-md border border-[#E4E4E7] bg-white">
          <div className="border-b border-[#E4E4E7] bg-[#FAFAFA] px-4 py-3">
            <p className="text-[14px] font-semibold text-[#18181B]">One-time credentials</p>
            <p className="mt-1 text-[12px] text-[#B45309]">These passwords are shown once. Share them securely.</p>
          </div>
          <div className="divide-y divide-[#E4E4E7]">
            {result.credentials.map((credential) => (
              <div key={credential.studentId} className="flex flex-col gap-1 px-4 py-3 text-[14px] sm:flex-row sm:items-center sm:justify-between">
                <span>Row {credential.row}</span>
                <code className="rounded bg-[#F4F4F5] px-2 py-1 text-[13px]">{credential.temporaryPassword}</code>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
