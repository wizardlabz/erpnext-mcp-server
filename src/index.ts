#!/usr/bin/env node

/**
 * ERPNext MCP Server
 * This server provides integration with the ERPNext/Frappe API, allowing:
 * - Authentication with ERPNext
 * - Fetching documents from ERPNext
 * - Querying lists of documents
 * - Creating and updating documents
 * - Running reports
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance } from "axios";
import { randomUUID } from "crypto";

// ERPNext API client configuration
class ERPNextClient {
  private baseUrl: string;
  private axiosInstance: AxiosInstance;
  private authenticated: boolean = false;

  constructor() {
    // Get ERPNext configuration from environment variables
    this.baseUrl = process.env.ERPNEXT_URL || '';
    
    // Validate configuration
    if (!this.baseUrl) {
      throw new Error("ERPNEXT_URL environment variable is required");
    }
    
    // Remove trailing slash if present
    this.baseUrl = this.baseUrl.replace(/\/$/, '');
    
    // Initialize axios instance
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    // Configure authentication if credentials provided
    const apiKey = process.env.ERPNEXT_API_KEY;
    const apiSecret = process.env.ERPNEXT_API_SECRET;
    
    if (apiKey && apiSecret) {
      this.axiosInstance.defaults.headers.common['Authorization'] = 
        `token ${apiKey}:${apiSecret}`;
      this.authenticated = true;
    }
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }

  // Get a document by doctype and name
  async getDocument(doctype: string, name: string): Promise<any> {
    try {
      const response = await this.axiosInstance.get(
        `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`
      );
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to get ${doctype} ${name}: ${error?.message || 'Unknown error'}`);
    }
  }

  // Get list of documents for a doctype
  async getDocList(doctype: string, filters?: Record<string, any>, fields?: string[], limit?: number): Promise<any[]> {
    try {
      let params: Record<string, any> = {};

      if (fields && fields.length) {
        params['fields'] = JSON.stringify(fields);
      }

      if (filters) {
        params['filters'] = JSON.stringify(filters);
      }

      if (limit) {
        params['limit_page_length'] = limit;
      }

      const response = await this.axiosInstance.get(
        `/api/resource/${encodeURIComponent(doctype)}`,
        { params }
      );
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to get ${doctype} list: ${error?.message || 'Unknown error'}`);
    }
  }

  // Create a new document
  async createDocument(doctype: string, doc: Record<string, any>): Promise<any> {
    try {
      const response = await this.axiosInstance.post(
        `/api/resource/${encodeURIComponent(doctype)}`,
        { data: doc }
      );
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to create ${doctype}: ${error?.message || 'Unknown error'}`);
    }
  }

  // Update an existing document
  async updateDocument(doctype: string, name: string, doc: Record<string, any>): Promise<any> {
    try {
      const response = await this.axiosInstance.put(
        `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`,
        { data: doc }
      );
      return response.data.data;
    } catch (error: any) {
      throw new Error(`Failed to update ${doctype} ${name}: ${error?.message || 'Unknown error'}`);
    }
  }

  // Run a report
  async runReport(reportName: string, filters?: Record<string, any>): Promise<any> {
    try {
      const response = await this.axiosInstance.get(`/api/method/frappe.desk.query_report.run`, {
        params: {
          report_name: reportName,
          filters: filters ? JSON.stringify(filters) : undefined
        }
      });
      return response.data.message;
    } catch (error: any) {
      throw new Error(`Failed to run report ${reportName}: ${error?.message || 'Unknown error'}`);
    }
  }

  // Call a server-side API method
  async callMethod(method: string, args?: Record<string, any>, httpMethod: "GET" | "POST" = "POST"): Promise<any> {
    try {
      // Encode each dotted segment so unusual characters don't break the URL.
      const encodedMethod = method.split('.').map(encodeURIComponent).join('.');
      let response;
      if (httpMethod === "GET") {
        response = await this.axiosInstance.get(`/api/method/${encodedMethod}`, { params: args });
      } else {
        response = await this.axiosInstance.post(`/api/method/${encodedMethod}`, args);
      }
      return response.data.message;
    } catch (error: any) {
      throw new Error(`Failed to call method ${method}: ${error?.message || 'Unknown error'}`);
    }
  }

  // Delete a document
  async deleteDocument(doctype: string, name: string): Promise<void> {
    try {
      await this.axiosInstance.delete(
        `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`
      );
    } catch (error: any) {
      throw new Error(`Failed to delete ${doctype} ${name}: ${error?.message || 'Unknown error'}`);
    }
  }

  // Get all available DocTypes
  async getAllDocTypes(): Promise<string[]> {
    try {
      // Use the standard REST API to fetch DocTypes
      const response = await this.axiosInstance.get('/api/resource/DocType', {
        params: {
          fields: JSON.stringify(["name"]),
          limit_page_length: 500 // Get more doctypes at once
        }
      });
      
      if (response.data && response.data.data) {
        return response.data.data.map((item: any) => item.name);
      }
      
      return [];
    } catch (error: any) {
      console.error("Failed to get DocTypes:", error?.message || 'Unknown error');
      
      // Try an alternative approach if the first one fails
      try {
        // Try using the method API to get doctypes
        const altResponse = await this.axiosInstance.get('/api/method/frappe.desk.search.search_link', {
          params: {
            doctype: 'DocType',
            txt: '',
            limit: 500
          }
        });
        
        if (altResponse.data && altResponse.data.results) {
          return altResponse.data.results.map((item: any) => item.value);
        }
        
        return [];
      } catch (altError: any) {
        console.error("Alternative DocType fetch failed:", altError?.message || 'Unknown error');
        
        // Fallback: Return a list of common DocTypes
        return [
          "Customer", "Supplier", "Item", "Sales Order", "Purchase Order",
          "Sales Invoice", "Purchase Invoice", "Employee", "Lead", "Opportunity",
          "Quotation", "Payment Entry", "Journal Entry", "Stock Entry"
        ];
      }
    }
  }
}

// Cache for doctype metadata
const doctypeCache = new Map<string, any>();

// Initialize ERPNext client
const erpnext = new ERPNextClient();

/**
 * Per-session delete-confirmation safeguard state.
 *
 * State lives for the lifetime of this server process. One process = one MCP
 * session = one Claude Code run; restarting Claude Code resets all of this.
 *
 * Goal: no ERPNext document is ever permanently deleted without the user being
 * explicitly asked, until the user chooses to opt out of the prompts.
 */
const DELETE_TOKEN_TTL_MS = 5 * 60 * 1000; // confirm tokens are valid ~5 minutes
const deleteSafeguard = {
  gatePromptCount: 0,        // how many delete requests have hit the gate this session
  skipConfirmations: false,  // true once the user opts out for the rest of the session
  pendingTokens: new Map<string, { doctype: string; name: string; ts: number }>(),
};

// Issue a fresh single-use confirmation token bound to a specific document.
function issueDeleteToken(doctype: string, name: string): string {
  const token = randomUUID();
  deleteSafeguard.pendingTokens.set(token, { doctype, name, ts: Date.now() });
  return token;
}

// Validate (and consume) a confirmation token for a specific document.
// Returns an error string if invalid, or null if the token is good and was consumed.
function consumeDeleteToken(token: string, doctype: string, name: string): string | null {
  const entry = deleteSafeguard.pendingTokens.get(token);
  if (!entry) {
    return "Invalid or already-used confirm_token. Re-call delete_document without a token to start a fresh confirmation.";
  }
  // Always consume so a token can never be reused, even on a mismatch.
  deleteSafeguard.pendingTokens.delete(token);
  if (Date.now() - entry.ts > DELETE_TOKEN_TTL_MS) {
    return "confirm_token has expired. Re-call delete_document without a token to start a fresh confirmation.";
  }
  if (entry.doctype !== doctype || entry.name !== name) {
    return `confirm_token does not match this document. It was issued for ${entry.doctype} '${entry.name}', not ${doctype} '${name}'. Re-call without a token to start a fresh confirmation.`;
  }
  return null;
}

// Create an MCP server with capabilities for resources and tools
const server = new Server(
  {
    name: "erpnext-server",
    version: "0.1.0"
  },
  {
    capabilities: {
      resources: {},
      tools: {}
    }
  }
);

/**
 * Handler for listing available ERPNext resources.
 * Exposes DocTypes list as a resource and common doctypes as individual resources.
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  // List of common DocTypes to expose as individual resources
  const commonDoctypes = [
    "Customer",
    "Supplier",
    "Item",
    "Sales Order",
    "Purchase Order",
    "Sales Invoice",
    "Purchase Invoice",
    "Employee"
  ];

  const resources = [
    // Add a resource to get all doctypes
    {
      uri: "erpnext://DocTypes",
      name: "All DocTypes",
      mimeType: "application/json",
      description: "List of all available DocTypes in the ERPNext instance"
    }
  ];

  return {
    resources
  };
});

/**
 * Handler for resource templates.
 * Allows querying ERPNext documents by doctype and name.
 */
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => {
  const resourceTemplates = [
    {
      uriTemplate: "erpnext://{doctype}/{name}",
      name: "ERPNext Document",
      mimeType: "application/json",
      description: "Fetch an ERPNext document by doctype and name"
    }
  ];

  return { resourceTemplates };
});

/**
 * Handler for reading ERPNext resources.
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (!erpnext.isAuthenticated()) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      "Not authenticated with ERPNext. Please configure API key authentication."
    );
  }

  const uri = request.params.uri;
  let result: any;

  // Handle special resource: erpnext://DocTypes (list of all doctypes)
  if (uri === "erpnext://DocTypes") {
    try {
      const doctypes = await erpnext.getAllDocTypes();
      result = { doctypes };
    } catch (error: any) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to fetch DocTypes: ${error?.message || 'Unknown error'}`
      );
    }
  } else {
    // Handle document access: erpnext://{doctype}/{name}
    const documentMatch = uri.match(/^erpnext:\/\/([^\/]+)\/(.+)$/);
    if (documentMatch) {
      const doctype = decodeURIComponent(documentMatch[1]);
      const name = decodeURIComponent(documentMatch[2]);
      
      try {
        result = await erpnext.getDocument(doctype, name);
      } catch (error: any) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Failed to fetch ${doctype} ${name}: ${error?.message || 'Unknown error'}`
        );
      }
    }
  }

  if (!result) {
    throw new McpError(
      ErrorCode.InvalidRequest,
      `Invalid ERPNext resource URI: ${uri}`
    );
  }

  return {
    contents: [{
      uri: request.params.uri,
      mimeType: "application/json",
      text: JSON.stringify(result, null, 2)
    }]
  };
});

/**
 * Handler that lists available tools.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_doctypes",
        description: "Get a list of all available DocTypes",
        inputSchema: {
          type: "object",
          properties: {}
        }
      },
      {
        name: "get_doctype_fields",
        description: "Get fields list for a specific DocType",
        inputSchema: {
          type: "object",
          properties: {
            doctype: {
              type: "string",
              description: "ERPNext DocType (e.g., Customer, Item)"
            }
          },
            required: ["doctype"]
        }
      },
      {
        name: "get_documents",
        description: "Get a list of documents for a specific doctype",
        inputSchema: {
          type: "object",
          properties: {
            doctype: {
              type: "string",
              description: "ERPNext DocType (e.g., Customer, Item)"
            },
            fields: {
              type: "array",
              items: {
                type: "string"
              },
              description: "Fields to include (optional)"
            },
            filters: {
              type: "object",
              additionalProperties: true,
              description: "Filters in the format {field: value} (optional)"
            },
            limit: {
              type: "number",
              description: "Maximum number of documents to return (optional)"
            }
          },
          required: ["doctype"]
        }
      },
      {
        name: "create_document",
        description: "Create a new document in ERPNext",
        inputSchema: {
          type: "object",
          properties: {
            doctype: {
              type: "string",
              description: "ERPNext DocType (e.g., Customer, Item)"
            },
            data: {
              type: "object",
              additionalProperties: true,
              description: "Document data"
            },
            verbose: {
              type: "boolean",
              description: "If true, return the full document in the response. Default is false (returns minimal confirmation only)."
            }
          },
          required: ["doctype", "data"]
        }
      },
      {
        name: "update_document",
        description: "Update an existing document in ERPNext",
        inputSchema: {
          type: "object",
          properties: {
            doctype: {
              type: "string",
              description: "ERPNext DocType (e.g., Customer, Item)"
            },
            name: {
              type: "string",
              description: "Document name/ID"
            },
            data: {
              type: "object",
              additionalProperties: true,
              description: "Document data to update"
            },
            verbose: {
              type: "boolean",
              description: "If true, return the full document in the response. Default is false (returns minimal confirmation only)."
            }
          },
          required: ["doctype", "name", "data"]
        }
      },
      {
        name: "run_report",
        description: "Run an ERPNext report",
        inputSchema: {
          type: "object",
          properties: {
            report_name: {
              type: "string",
              description: "Name of the report"
            },
            filters: {
              type: "object",
              additionalProperties: true,
              description: "Report filters (optional)"
            }
          },
          required: ["report_name"]
        }
      },
      {
        name: "get_document",
        description: "Get a single document by DocType and name, including all child tables and linked data",
        inputSchema: {
          type: "object",
          properties: {
            doctype: {
              type: "string",
              description: "ERPNext DocType (e.g., Customer, Sales Order, BOM)"
            },
            name: {
              type: "string",
              description: "Document name/ID"
            }
          },
          required: ["doctype", "name"]
        }
      },
      {
        name: "call_method",
        description: "Call an ERPNext/Frappe whitelisted server-side API method. Can invoke any whitelisted method — use with caution. Args are passed as JSON body (POST) or query params (GET).",
        inputSchema: {
          type: "object",
          properties: {
            method: {
              type: "string",
              description: "Dotted method path (e.g., frappe.client.get_count, erpnext.manufacturing.doctype.work_order.work_order.make_stock_entry)"
            },
            args: {
              type: "object",
              additionalProperties: true,
              description: "Method arguments as key-value pairs (optional)"
            },
            http_method: {
              type: "string",
              enum: ["GET", "POST"],
              description: "HTTP method to use (default: POST). Use GET for read-only methods."
            }
          },
          required: ["method"]
        }
      },
      {
        name: "submit_document",
        description: "Submit a document (set docstatus to 1). Only works on submittable doctypes. Submitted documents can only be cancelled, not reverted to draft.",
        inputSchema: {
          type: "object",
          properties: {
            doctype: {
              type: "string",
              description: "ERPNext DocType (e.g., Sales Invoice, Journal Entry)"
            },
            name: {
              type: "string",
              description: "Document name/ID"
            },
            verbose: {
              type: "boolean",
              description: "If true, return the full document in the response. Default is false (returns minimal confirmation only)."
            }
          },
          required: ["doctype", "name"]
        }
      },
      {
        name: "cancel_document",
        description: "Cancel a submitted document (set docstatus to 2). Cancelled documents cannot be modified — use amend workflow to create a corrected copy.",
        inputSchema: {
          type: "object",
          properties: {
            doctype: {
              type: "string",
              description: "ERPNext DocType"
            },
            name: {
              type: "string",
              description: "Document name/ID"
            },
            verbose: {
              type: "boolean",
              description: "If true, return the full document in the response. Default is false (returns minimal confirmation only)."
            }
          },
          required: ["doctype", "name"]
        }
      },
      {
        name: "delete_document",
        description: "Permanently delete a document from ERPNext. This action cannot be undone. Submitted documents must be cancelled before deletion. SAFEGUARD: the first delete attempt of a session is BLOCKED and returns a one-time confirm_token — you must explicitly confirm with the user, then re-call with that token. From the 3rd delete onward you may also offer the user skip_future_confirmations to disable the prompt for the rest of the session.",
        inputSchema: {
          type: "object",
          properties: {
            doctype: {
              type: "string",
              description: "ERPNext DocType"
            },
            name: {
              type: "string",
              description: "Document name/ID"
            },
            confirm_token: {
              type: "string",
              description: "One-time token returned by a prior blocked delete attempt. Only pass this AFTER the user has explicitly confirmed the deletion. The token is single-use, bound to this exact doctype+name, and expires after ~5 minutes."
            },
            skip_future_confirmations: {
              type: "boolean",
              description: "Pass true (together with a valid confirm_token) ONLY when the user has explicitly asked to stop being warned about deletes. Disables the delete confirmation safeguard for the rest of the session."
            }
          },
          required: ["doctype", "name"]
        }
      }
    ]
  };
});

/**
 * Handler for tool calls.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (!erpnext.isAuthenticated()) {
    return {
      content: [{
        type: "text",
        text: "Not authenticated with ERPNext. Please configure API key authentication."
      }],
      isError: true
    };
  }

  switch (request.params.name) {
    case "get_documents": {
      const doctype = String(request.params.arguments?.doctype);
      const fields = request.params.arguments?.fields as string[] | undefined;
      const filters = request.params.arguments?.filters as Record<string, any> | undefined;
      const limit = request.params.arguments?.limit as number | undefined;
      
      if (!doctype) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Doctype is required"
        );
      }
      
      try {
        const documents = await erpnext.getDocList(doctype, filters, fields, limit);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(documents, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to get ${doctype} documents: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }
    
    case "create_document": {
      const doctype = String(request.params.arguments?.doctype);
      const data = request.params.arguments?.data as Record<string, any> | undefined;
      const verbose = request.params.arguments?.verbose === true;
      
      if (!doctype || !data) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Doctype and data are required"
        );
      }
      
      try {
        const result = await erpnext.createDocument(doctype, data);
        if (verbose) {
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify({
            status: "success",
            doctype: doctype,
            name: result.name,
            docstatus: result.docstatus
          }) }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to create ${doctype}: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }
    
    case "update_document": {
      const doctype = String(request.params.arguments?.doctype);
      const name = String(request.params.arguments?.name);
      const data = request.params.arguments?.data as Record<string, any> | undefined;
      const verbose = request.params.arguments?.verbose === true;
      
      if (!doctype || !name || !data) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Doctype, name, and data are required"
        );
      }
      
      try {
        const result = await erpnext.updateDocument(doctype, name, data);
        if (verbose) {
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify({
            status: "success",
            doctype: doctype,
            name: result.name,
            docstatus: result.docstatus
          }) }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to update ${doctype} ${name}: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }
    
    case "run_report": {
      const reportName = String(request.params.arguments?.report_name);
      const filters = request.params.arguments?.filters as Record<string, any> | undefined;
      
      if (!reportName) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Report name is required"
        );
      }
      
      try {
        const result = await erpnext.runReport(reportName, filters);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to run report ${reportName}: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }
    
    case "get_document": {
      const doctype = String(request.params.arguments?.doctype);
      const name = String(request.params.arguments?.name);
      
      if (!doctype || !name) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Doctype and name are required"
        );
      }
      
      try {
        const document = await erpnext.getDocument(doctype, name);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(document, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to get ${doctype} ${name}: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }
    
    case "call_method": {
      const method = String(request.params.arguments?.method);
      const args = request.params.arguments?.args as Record<string, any> | undefined;
      const httpMethod = (request.params.arguments?.http_method as "GET" | "POST") || "POST";
      
      if (!method) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Method is required"
        );
      }
      
      try {
        const result = await erpnext.callMethod(method, args, httpMethod);
        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to call method ${method}: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }
    
    case "submit_document": {
      const doctype = String(request.params.arguments?.doctype);
      const name = String(request.params.arguments?.name);
      const verbose = request.params.arguments?.verbose === true;
      
      if (!doctype || !name) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Doctype and name are required"
        );
      }
      
      try {
        // frappe.client.submit constructs the doc from the passed dict rather
        // than loading from DB, so it needs the full document with all fields.
        const fullDoc = await erpnext.getDocument(doctype, name);
        const result = await erpnext.callMethod('frappe.client.submit', { doc: fullDoc });
        if (verbose) {
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
          };
        }
        if (!result || typeof result !== "object" || result.name == null || result.docstatus == null) {
          throw new McpError(
            ErrorCode.InternalError,
            `Unexpected response from ERPNext while submitting ${doctype} ${name}`
          );
        }
        return {
          content: [{ type: "text", text: JSON.stringify({
            status: "success",
            doctype: doctype,
            name: result.name,
            docstatus: result.docstatus
          }) }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to submit ${doctype} ${name}: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }

    case "cancel_document": {
      const doctype = String(request.params.arguments?.doctype);
      const name = String(request.params.arguments?.name);
      const verbose = request.params.arguments?.verbose === true;
      
      if (!doctype || !name) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Doctype and name are required"
        );
      }
      
      try {
        const result = await erpnext.callMethod('frappe.client.cancel', { doctype, name });
        if (verbose) {
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
          };
        }
        if (!result || typeof result !== "object" || result.name == null || result.docstatus == null) {
          throw new McpError(
            ErrorCode.InternalError,
            `Unexpected response from ERPNext while cancelling ${doctype} ${name}`
          );
        }
        return {
          content: [{ type: "text", text: JSON.stringify({
            status: "success",
            doctype: doctype,
            name: result.name,
            docstatus: result.docstatus
          }) }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to cancel ${doctype} ${name}: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }
    
    case "delete_document": {
      const doctype = String(request.params.arguments?.doctype);
      const name = String(request.params.arguments?.name);
      const confirmToken = request.params.arguments?.confirm_token
        ? String(request.params.arguments.confirm_token)
        : undefined;
      const skipFutureConfirmations =
        request.params.arguments?.skip_future_confirmations === true;

      if (!doctype || !name) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Doctype and name are required"
        );
      }

      // Confirmation safeguard: unless the user has opted out for this session,
      // a delete must be confirmed via a one-time token before it is carried out.
      if (!deleteSafeguard.skipConfirmations) {
        if (!confirmToken) {
          // First leg of the handshake: block the delete and issue a token.
          deleteSafeguard.gatePromptCount += 1;
          const token = issueDeleteToken(doctype, name);
          const offerOptOut = deleteSafeguard.gatePromptCount >= 3;

          const lines = [
            `⛔ DELETE BLOCKED — confirmation required.`,
            ``,
            `You are about to PERMANENTLY delete ${doctype} '${name}'. This cannot be undone.`,
            ``,
            `Before proceeding you MUST:`,
            `  1. Tell the user exactly what will be deleted (${doctype} '${name}').`,
            `  2. Get the user's explicit approval.`,
            ``,
            `Once — and only once — the user has approved, re-call delete_document with the same`,
            `doctype and name plus confirm_token: "${token}". The token is single-use, valid for ~5`,
            `minutes, and only works for this exact document.`,
          ];
          if (offerOptOut) {
            lines.push(
              ``,
              `This is delete #${deleteSafeguard.gatePromptCount} this session. You may now also ASK the`,
              `user whether they want to stop being prompted for the rest of the session. If — and only`,
              `if — they explicitly say yes, include skip_future_confirmations: true alongside the`,
              `confirm_token on the next call to disable this safeguard for the remainder of the session.`
            );
          }

          return {
            content: [{ type: "text", text: JSON.stringify({
              status: "confirmation_required",
              action: "blocked",
              doctype,
              name,
              confirm_token: token,
              delete_attempt_this_session: deleteSafeguard.gatePromptCount,
              offer_skip_future_confirmations: offerOptOut,
              message: lines.join("\n")
            }, null, 2) }]
          };
        }

        // Second leg: a token was supplied — validate (and consume) it.
        const tokenError = consumeDeleteToken(confirmToken, doctype, name);
        if (tokenError) {
          return {
            content: [{ type: "text", text: JSON.stringify({
              status: "confirmation_invalid",
              action: "blocked",
              doctype,
              name,
              message: tokenError
            }, null, 2) }],
            isError: true
          };
        }

        // The user confirmed via a valid token. If they also asked to stop being
        // prompted, honour that intent now — independent of whether the ERPNext
        // delete below succeeds, so a transient failure doesn't discard the choice.
        if (skipFutureConfirmations) {
          deleteSafeguard.skipConfirmations = true;
        }
      }

      try {
        await erpnext.deleteDocument(doctype, name);

        let optOutNote: string | undefined;
        if (skipFutureConfirmations) {
          optOutNote =
            "⚠️ Delete confirmations are now DISABLED for the rest of this session (until the MCP server restarts).";
        } else if (deleteSafeguard.skipConfirmations) {
          optOutNote = "(delete confirmations are disabled for this session)";
        }

        return {
          content: [{ type: "text", text: JSON.stringify({
            status: "success",
            action: "deleted",
            doctype: doctype,
            name: name,
            ...(optOutNote ? { note: optOutNote } : {})
          }, null, 2) }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to delete ${doctype} ${name}: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }
    
    case "get_doctype_fields": {
      const doctype = String(request.params.arguments?.doctype);
      
      if (!doctype) {
        throw new McpError(
          ErrorCode.InvalidParams,
          "Doctype is required"
        );
      }
      
      try {
        // Get a sample document to understand the fields
        const documents = await erpnext.getDocList(doctype, {}, ["*"], 1);
        
        if (!documents || documents.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No documents found for ${doctype}. Cannot determine fields.`
            }],
            isError: true
          };
        }
        
        // Extract field names from the first document
        const sampleDoc = documents[0];
        const fields = Object.keys(sampleDoc).map(field => ({
          fieldname: field,
          value: typeof sampleDoc[field],
          sample: sampleDoc[field]?.toString()?.substring(0, 50) || null
        }));
        
        return {
          content: [{
            type: "text",
            text: JSON.stringify(fields, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to get fields for ${doctype}: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }
    
    case "get_doctypes": {
      try {
        const doctypes = await erpnext.getAllDocTypes();
        return {
          content: [{
            type: "text",
            text: JSON.stringify(doctypes, null, 2)
          }]
        };
      } catch (error: any) {
        return {
          content: [{
            type: "text",
            text: `Failed to get DocTypes: ${error?.message || 'Unknown error'}`
          }],
          isError: true
        };
      }
    }
      
    default:
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown tool: ${request.params.name}`
      );
  }
});

/**
 * Start the server using stdio transport.
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('ERPNext MCP server running on stdio');
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
