# ERPNext MCP Server

**Connect AI assistants to ERPNext — with a guardrail that makes deletes deliberate.**

A TypeScript [Model Context Protocol](https://modelcontextprotocol.io) server for ERPNext/Frappe. Any MCP client — Claude Desktop, Claude Code, Cursor, Cline and others — can browse DocTypes, read and search documents, create, update, submit and cancel records, call whitelisted server methods and run reports against your ERPNext instance, using the same REST API you would use yourself.

This is the version we run at [Wizard Labz](https://wizardlabz.com) when an assistant works against a live ERP. It differs from the upstream project in one way that matters: **nothing is deleted without a human saying so.**

## Delete safeguard

ERPNext deletes are permanent. A submitted document has to be cancelled first, but a draft — or any record that passes referential checks — is gone the moment `delete_document` runs, with no undo. When an AI assistant is driving, a single misread instruction can quietly destroy real business data.

This server turns `delete_document` into a two-step handshake. The other ten tools are untouched and fully backward compatible.

1. **First call is refused.** Any `delete_document` call without a valid token is blocked. The server returns a single-use `confirm_token` bound to that exact `doctype` + `name`, expiring after about 5 minutes, together with an instruction to the assistant: tell the user precisely what will be deleted and get explicit approval.
2. **Second call deletes.** Once the user approves, the assistant calls `delete_document` again with the same `doctype`/`name` plus the `confirm_token`. The token is consumed and the delete proceeds.

**Opt-out.** From the third gated delete in a session, the assistant may offer the user a `skip_future_confirmations` flag. If the user explicitly agrees, passing that flag with a valid token disables the safeguard for the rest of the session. A session is the lifetime of the MCP server process; state resets on restart.

The confirmation copy is intentionally friendly and conversational ("🛟 Quick safety check before deleting…") rather than alarming.

## Features

### Resources
- Access ERPNext documents via `erpnext://{doctype}/{name}` URIs
- JSON format for structured data access

### Tools
- `get_doctypes` - Get a list of all available DocTypes
- `get_doctype_fields` - Get fields list for a specific DocType
- `get_documents` - Get a list of documents for a specific doctype
- `get_document` - Get a single document by name, including all child tables
- `create_document` - Create a new document in ERPNext
- `update_document` - Update an existing document in ERPNext
- `delete_document` - Permanently delete a document (gated by the two-step confirmation safeguard — see [Delete safeguard](#delete-safeguard))
- `submit_document` - Submit a document (set docstatus to 1)
- `cancel_document` - Cancel a submitted document (set docstatus to 2)
- `call_method` - Call an ERPNext/Frappe whitelisted server-side API method
- `run_report` - Run an ERPNext report

## Configuration

The server requires the following environment variables:
- `ERPNEXT_URL` - The base URL of your ERPNext instance
- `ERPNEXT_API_KEY` (optional) - API key for authentication
- `ERPNEXT_API_SECRET` (optional) - API secret for authentication

## Development

Install dependencies:
```bash
npm install
```

Build the server:
```bash
npm run build
```

For development with auto-rebuild:
```bash
npm run watch
```

## Installation

To use with Claude Desktop, add the server config:

On MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
On Windows: `%APPDATA%/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "erpnext": {
      "command": "node",
      "args": ["/path/to/erpnext-server/build/index.js"],
      "env": {
        "ERPNEXT_URL": "http://your-erpnext-instance.com",
        "ERPNEXT_API_KEY": "your-api-key",
        "ERPNEXT_API_SECRET": "your-api-secret"
      }
    }
  }
}
```

To use with Claude in VSCode, add the server config to:

On MacOS: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
On Windows: `%APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`

### Debugging

Since MCP servers communicate over stdio, debugging can be challenging. We recommend using the [MCP Inspector](https://github.com/modelcontextprotocol/inspector), which is available as a package script:

```bash
npm run inspector
```

The Inspector will provide a URL to access debugging tools in your browser.

## Usage Examples

### Get Customer List
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>get_documents</tool_name>
<arguments>
{
  "doctype": "Customer"
}
</arguments>
</use_mcp_tool>
```

### Get Customer Details
```
<access_mcp_resource>
<server_name>erpnext</server_name>
<uri>erpnext://Customer/CUSTOMER001</uri>
</access_mcp_resource>
```

### Create New Item
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>create_document</tool_name>
<arguments>
{
  "doctype": "Item",
  "data": {
    "item_code": "ITEM001",
    "item_name": "Test Item",
    "item_group": "Products",
    "stock_uom": "Nos"
  }
}
</arguments>
</use_mcp_tool>
```

### Get Item Fields
```
<use_mcp_tool>
<server_name>erpnext</server_name>
<tool_name>get_doctype_fields</tool_name>
<arguments>
{
  "doctype": "Item"
}
</arguments>
</use_mcp_tool>

## Origin

Forked from [`rakeshgangwar/erpnext-mcp-server`](https://github.com/rakeshgangwar/erpnext-mcp-server), which provides the ERPNext integration itself. The delete safeguard is the only behavioural change; upstream improvements can be merged without touching it.
