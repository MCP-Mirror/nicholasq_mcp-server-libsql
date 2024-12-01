import { ResultSet } from "@libsql/client";

export function resultSetToCsv(rs: ResultSet) {
  const escapeField = (field: unknown) => {
    if (field === null) return "";
    const str = String(field);
    return str.includes(",") ? `"${str}"` : str;
  };

  const header = rs.columns.join(",");
  const rows = rs.rows.map((row) =>
    rs.columns.map((col) => escapeField(row[col])).join(",")
  ).join("\n");

  return `${header}\n${rows}`;
}

export function logger(logFile?: string, debug: boolean = false) {
  if (debug && !logFile) {
    throw new Error("No log file path provided");
  }
  return {
    debug: async function (label: string, message: string) {
      if (debug) {
        await Deno.writeTextFile(
          logFile!,
          `${label}() - ${message}\n`,
          {
            create: true,
            append: true,
          },
        );
      }
    },
  };
}
