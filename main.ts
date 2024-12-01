import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { parseArgs } from "@std/cli";
import { z } from "zod";
import { createClient, Row } from "@libsql/client";
import { logger, resultSetToCsv } from "./utils.ts";

const SCHEMA_PROMPT_NAME = "libsql-schema";
const QUERY_PROMPT_NAME = "libsql-query";
const ALL_TABLES = "all-tables";
const FETCH_ALL_TABLES_QUERY =
  "SELECT * FROM sqlite_master WHERE type = 'table'";

interface SqliteMaster extends Row {
  type: string;
  name: string;
  tbl_name: string;
  rootpage: number;
  sql: string;
}

const args = parseArgs(Deno.args);
const argsSchema = z.object({
  "auth-token": z.string().nullish(),
  "log-file": z.string().nullish(),
  "debug": z.boolean().nullish(),
  "_": z.array(z.string().regex(/^(https?|libsql):\/\//)).nonempty(),
});

argsSchema.parse(args);

const dbUrl = args._[0] as string;
const authToken = args["auth-token"];
const logFile = args["log-file"];
const debug = args["debug"];
const log = logger(logFile, debug);
const db = createClient({ url: dbUrl, authToken });

const server = new Server(
  {
    name: "context-server/libsql",
    version: "0.0.2",
  },
  {
    capabilities: {
      resources: {},
      prompts: {},
      tools: {},
    },
  },
);

server.setRequestHandler(ListResourcesRequestSchema, async (request) => {
  await log.debug("ListResourcesRequestSchema", `${JSON.stringify(request)}`);

  const rs = await db.execute(FETCH_ALL_TABLES_QUERY);
  const rows = rs.rows as SqliteMaster[];
  const tables = rows.map((row) => row.tbl_name);

  return {
    resources: tables.map((table) => ({
      uri: new URL(`${table}/schema`, dbUrl).href,
      name: `${table} table schema`,
    })),
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  await log.debug("ReadResourceRequestSchema", `${JSON.stringify(request)}`);
  const resourceUrl = new URL(request.params.uri);
  const pathComponents = resourceUrl.pathname.split("/");
  const schema = pathComponents.pop();
  const tableName = pathComponents.pop()?.trim();

  if (schema !== "schema") {
    throw new Error("Invalid resource URI");
  }

  if (tableName === undefined) {
    throw new Error("No table name provided");
  }

  const rs = await db.execute({
    sql: "SELECT * FROM sqlite_master WHERE type = 'table' AND tbl_name = ?",
    args: [tableName],
  });

  if (rs.rows.length === 0) {
    throw new Error(`Table '${tableName}' not found`);
  }

  const rows = rs.rows as SqliteMaster[];

  return {
    contents: [
      {
        uri: request.params.uri,
        mimeType: "text/plain",
        text: rows[0].sql,
      },
    ],
  };
});

server.setRequestHandler(CompleteRequestSchema, async (request) => {
  await log.debug("CompleteRequestSchema", `${JSON.stringify(request)}`);
  if (
    request.params.ref.name === SCHEMA_PROMPT_NAME ||
    request.params.ref.name === QUERY_PROMPT_NAME
  ) {
    const tableNameQuery = request.params.argument.value;
    const alreadyHasArg = /\S*\s/.test(tableNameQuery);

    if (alreadyHasArg) {
      return { completion: { values: [] } };
    }

    const rs = await db.execute(FETCH_ALL_TABLES_QUERY);
    const rows = rs.rows as SqliteMaster[];
    const tables = rows.map((row) => row.tbl_name);

    return {
      completion: {
        values: [ALL_TABLES, ...tables],
      },
    };
  }

  throw new Error("unknown prompt");
});

server.setRequestHandler(ListPromptsRequestSchema, async (request) => {
  await log.debug("ListPromptsRequestSchema", `${JSON.stringify(request)}`);
  return {
    prompts: [
      {
        name: SCHEMA_PROMPT_NAME,
        description:
          "Retrieve the schema for a given table in the libSQL database",
        arguments: [{
          name: "tableName",
          description: "the table to describe",
          required: true,
        }],
      },
      {
        name: QUERY_PROMPT_NAME,
        description: "Query all rows from a table",
        arguments: [{
          name: "tableName",
          description: "the table to query",
          required: true,
        }],
      },
    ],
  };
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  await log.debug("GetPromptRequestSchema", `${JSON.stringify(request)}`);
  if (request.params.name === SCHEMA_PROMPT_NAME) {
    const tableName = request.params.arguments?.tableName;

    if (typeof tableName !== "string" || tableName.length === 0) {
      throw new Error(`Invalid tableName: ${tableName}`);
    }

    let schema: string;
    if (tableName === ALL_TABLES) {
      const rs = await db.execute(FETCH_ALL_TABLES_QUERY);
      const rows = rs.rows as SqliteMaster[];
      schema = rows.map((row) => row.sql).join("\n\n");
    } else {
      const rs = await db.execute({
        sql: "SELECT * FROM sqlite_master WHERE type='table' AND tbl_name = ?",
        args: [tableName],
      });
      const rows = rs.rows as SqliteMaster[];
      schema = rows.map((row) => row.sql).join("\n\n");
    }

    return {
      description: tableName === ALL_TABLES
        ? "all table schemas"
        : `${tableName} schema`,
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: "```sql\n" + schema + "\n```",
        },
      }],
    };
  }

  if (request.params.name === QUERY_PROMPT_NAME) {
    const tableName = request.params.arguments?.tableName;

    if (typeof tableName !== "string" || tableName.length === 0) {
      throw new Error(`Invalid tableName: ${tableName}`);
    }

    const rs = await db.execute(`SELECT * FROM ${tableName} LIMIT 500`);
    const rows = rs.rows;

    if (rows.length === 0) {
      return {
        messages: [{
          role: "user",
          content: {
            type: "text",
            text: `No rows found in table ${tableName}`,
          },
        }],
      };
    }

    const csv = resultSetToCsv(rs);

    return {
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: csv,
        },
      }],
    };
  }

  throw new Error(`Prompt '${request.params.name}' not implemented`);
});

server.setRequestHandler(ListToolsRequestSchema, async (request) => {
  await log.debug("ListToolsRequestSchema", `${JSON.stringify(request)}`);
  return {
    tools: [
      {
        name: "query",
        description: "Run a read-only SQL query",
        inputSchema: {
          type: "object",
          properties: {
            sql: { type: "string" },
          },
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  await log.debug("CallToolRequestSchema", `${JSON.stringify(request)}`);
  if (request.params.name === "query") {
    const sql = request.params.arguments?.sql as string;
    const res = await db.execute(sql);
    return { content: [{ type: "string", text: JSON.stringify(res.rows) }] };
  }
  throw new Error("Tool not found");
});

const transport = new StdioServerTransport();
await server.connect(transport);
