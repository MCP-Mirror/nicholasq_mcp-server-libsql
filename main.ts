import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  {
    name: "context-server/libsql",
    version: "0.0.1",
  },
  {
    capabilities: {
      resources: {},
    },
  },
);

const args = Deno.args;

if (args.length === 0) {
  console.error(
    "Please provide a database URL as a command-line argument.",
  );
  Deno.exit(1);
}

const dbUrl = args[0];

if (!dbUrl.match(/^(https?|libsql):\/\//)) {
  console.error("Database URL must start with http://, https:// or libsql://");
  Deno.exit(1);
}

if (!dbUrl.match(/^https?:\/\//)) {
  console.error("Database URL must start with http:// or https://");
  Deno.exit(1);
}

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const listTablesCommand = new Deno.Command("turso", {
    args: ["db", "shell", dbUrl, ".tables"],
  });
  const { code, stdout, stderr } = await listTablesCommand.output();

  if (code !== 0) {
    const error = new TextDecoder("utf-8").decode(stderr);
    throw new Error(error);
  }

  const output = new TextDecoder("utf-8").decode(stdout);
  const tables = output.trim().split("\n").map((t) => t?.trim()).filter(
    Boolean,
  );

  return {
    resources: tables.map((table) => ({
      uri: new URL(`${table}/schema`, dbUrl).href,
      name: `${table} table schema`,
    })),
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
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

  const tableSchemaCommand = new Deno.Command("turso", {
    args: ["db", "shell", dbUrl, `.schema ${tableName}`],
  });
  const { code, stdout, stderr } = await tableSchemaCommand.output();

  if (code !== 0) {
    const error = new TextDecoder("utf-8").decode(stderr);
    throw new Error(error);
  }

  const output = new TextDecoder("utf-8").decode(stdout)?.trim();

  return {
    contents: [
      {
        uri: request.params.uri,
        mimeType: "text/plain",
        text: output,
      },
    ],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
